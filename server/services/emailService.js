

import nodemailer from 'nodemailer';


// Send verification email with Microsoft Graph API (single implementation, with error handling)
export const sendVerificationEmailGraph = async (toEmail, firstName, token) => {
  const {
    AZURE_TENANT_ID,
    AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET,
    SENDER_EMAIL
  } = process.env;

  // Use API_URL from environment or fallback
  const API_URL = process.env.API_URL || 'http://localhost:3001/api';

  if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET || !SENDER_EMAIL) {
    throw new Error('Missing required environment variables for sending verification email.');
  }

  let Client, ClientSecretCredential;
  try {
    Client = (await import('@microsoft/microsoft-graph-client')).Client;
    ClientSecretCredential = (await import('@azure/identity')).ClientSecretCredential;
  } catch (err) {
    throw new Error('Microsoft Graph dependencies not installed. Please install @microsoft/microsoft-graph-client and @azure/identity.');
  }

  const credential = new ClientSecretCredential(
    AZURE_TENANT_ID,
    AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET
  );

  const graphClient = Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const tokenObj = await credential.getToken('https://graph.microsoft.com/.default');
        return tokenObj.token;
      }
    }
  });

  const verifyUrl = `${API_URL}/auth/verify-email?token=${token}`;
  const subject = 'Verify your email address';
  const body = `Hello${firstName ? ' ' + firstName : ''},\n\nPlease verify your email by clicking the link below:\n${verifyUrl}\n\nIf you did not sign up, you can ignore this email.`;

  try {
    await graphClient.api('/users/' + SENDER_EMAIL + '/sendMail').post({
      message: {
        subject,
        body: {
          contentType: 'Text',
          content: body
        },
        toRecipients: [
          { emailAddress: { address: toEmail } }
        ]
      }
    });
    console.log(`✅ Verification email sent successfully to ${toEmail}`);
    return { success: true };
  } catch (err) {
    console.error('❌ Failed to send verification email:', err);
    throw new Error('Failed to send verification email. Please try again later.');
  }
};
// Create reusable transporter object using SMTP transport
const createTransporter = () => {
  const emailConfig = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 5,
  };
  if (process.env.SMTP_HOST?.includes('outlook') || process.env.SMTP_HOST?.includes('hotmail')) {
    emailConfig.requireTLS = true;
    emailConfig.tls = {
      ciphers: 'SSLv3'
    };
  }
  return nodemailer.createTransport(emailConfig);
};

// ...existing code...
// Send password reset email with Microsoft Graph API (single implementation, with error handling)
export const sendPasswordResetEmail = async (toEmail, resetToken) => {
  const {
    AZURE_TENANT_ID,
    AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET,
    SENDER_EMAIL
  } = process.env;

  // Use CLIENT_URL from environment or fallback
  const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:8080';

  if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET || !SENDER_EMAIL) {
    throw new Error('Missing required environment variables for sending password reset email.');
  }

  let Client, ClientSecretCredential;
  try {
    Client = (await import('@microsoft/microsoft-graph-client')).Client;
    ClientSecretCredential = (await import('@azure/identity')).ClientSecretCredential;
  } catch (err) {
    throw new Error('Microsoft Graph dependencies not installed. Please install @microsoft/microsoft-graph-client and @azure/identity.');
  }

  const credential = new ClientSecretCredential(
    AZURE_TENANT_ID,
    AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET
  );

  const graphClient = Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const tokenObj = await credential.getToken('https://graph.microsoft.com/.default');
        return tokenObj.token;
      }
    }
  });

  const resetUrl = `${CLIENT_URL}/reset-password?token=${resetToken}`;
  const subject = '🔐 Password Reset Request - Action Required';
  const body = `Hello,\n\nWe received a request to reset the password for your WhatsApp Broadcast Platform account.\n\nClick this link to reset your password: ${resetUrl}\n\nSECURITY INFORMATION:\n- This link will expire in 1 hour\n- Use this link only once to reset your password\n- If you didn't request this reset, please ignore this email\n\nBest regards,\nWhatsApp Broadcast Platform Team\n\nThis is an automated security email. Please do not reply to this message.`;

  try {
    await graphClient.api('/users/' + SENDER_EMAIL + '/sendMail').post({
      message: {
        subject,
        body: {
          contentType: 'Text',
          content: body
        },
        toRecipients: [
          { emailAddress: { address: toEmail } }
        ]
      },
      saveToSentItems: 'false'
    });
    console.log(`✅ Password reset email sent successfully to ${toEmail}`);
    return { success: true };
  } catch (err) {
    console.error('❌ Failed to send password reset email:', err);
    throw new Error('Failed to send password reset email. Please try again later.');
  }
};

// Test email configuration with detailed feedback
export const testEmailConfig = async () => {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log('✅ Email configuration test passed');
    return {
      success: true,
      message: 'Email configuration is valid and ready to send emails',
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('❌ Email configuration test failed:', error);
    let errorDetails = 'Unknown error';
    if (error.code === 'EAUTH') {
      errorDetails = 'Authentication failed. Check your email and app password.';
    } else if (error.code === 'ECONNECTION') {
      errorDetails = 'Connection failed. Check SMTP host and port settings.';
    } else if (error.code === 'ETIMEDOUT') {
      errorDetails = 'Connection timeout. Check your internet connection and firewall settings.';
    }
    return {
      success: false,
      error: error.message,
      details: errorDetails,
      timestamp: new Date().toISOString()
    };
  }
};
