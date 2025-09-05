require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { DOMParser } = require('xmldom'); 

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Initialize Supabase client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Initialize Nodemailer transporter
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // Use TLS
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

// Function to format GitHub XML feed into a string
function formatGitHubFeed(xmlString) {
  try {
    // Parse the XML string
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'application/xml');

    // Check for XML parsing errors
    const parserError = xmlDoc.getElementsByTagName('parsererror');
    if (parserError.length > 0) {
      throw new Error('Failed to parse XML');
    }

    // Get all <entry> elements
    const entries = xmlDoc.getElementsByTagName('entry');

    // Map entries to formatted strings
    const update = Array.from(entries)
      .map((entry) => {
        const title = entry.getElementsByTagName('title')[0]?.textContent || '';
        const type = title.includes('pushed') ? 'push' : 'unknown';

        const actorLogin = entry.getElementsByTagName('author')[0]
          ?.getElementsByTagName('name')[0]?.textContent || 'unknown';

        const repoMatch = title.match(/pushed (.*)$/);
        const repoName = repoMatch ? repoMatch[1] : 'unknown';

        const createdAt = entry.getElementsByTagName('published')[0]?.textContent || '';
        const formattedDate = createdAt ? new Date(createdAt).toLocaleString() : 'unknown';

        return `- ${type} by ${actorLogin} on repo ${repoName} at ${formattedDate}`;
      }).slice(0, 5).join('\n');

    return update || 'No events found';
  } catch (err) {
    console.error('Error parsing XML:', err.message);
    return 'Failed to parse GitHub events';
  }
}

// Function to fetch GitHub data and send email
async function fetchAndSendUpdate(email) {
  try {
    console.log('Fetching GitHub events for:', email);
  
    const response = await axios.get('https://github.com/timeline', {
      headers: { Accept: 'application/atom+xml' },
    });
    console.log('GitHub API response status:', response.status);

   
    const xmlString = response.data;
    const update = formatGitHubFeed(xmlString);
    console.log('Formatted update:', update);

    console.log('Sending email to:', email);
    await transporter.sendMail({
      from: `"GitHub Updates" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: 'GitHub Timeline Update',
      text: `Latest GitHub Events:\n\n${update}`,
    });
    console.log(`Email sent to ${email}`);

  } catch (err) {
    console.error('Error in fetchAndSendUpdate:', err.message);
    throw err;
  }
}

// Endpoint to handle signup and send initial email
app.post('/signup', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  // Store email in Supabase
  const { data, error } = await supabase.from('users').insert([{ email }]);
  if (error) {
    console.error('Supabase error:', error);
    return res.status(500).json({ error: 'Failed to store email' });
  }

  // Fetch GitHub timeline and send email
  try {
    await fetchAndSendUpdate(email);
    res.json({ message: 'Signup successful, update sent!' });
  } catch (err) {
    console.error('Error in signup:', err.message);
    res.status(500).json({ error: 'Failed to send update' });
  }
});

// Cron job to send daily updates to all users (runs every day at midnight IST)
cron.schedule('0 0 * * *', async () => {
  console.log('Running daily cron job at', new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const { data: users, error } = await supabase.from('users').select('email');
  if (error) {
    console.error('Supabase error in cron:', error);
    return;
  }
  for (const user of users) {
    console.log(`Sending update to ${user.email}`);
    await fetchAndSendUpdate(user.email);
  }
}, {
  timezone: 'Asia/Kolkata', // Set cron job to IST
});

app.listen(port, () => {
  console.log(`Backend running on http://localhost:${port}`);
});