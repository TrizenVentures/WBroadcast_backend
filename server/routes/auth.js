import express from 'express';
import passport from '../config/passport.js';
import User from '../models/User.js';
import { generateToken, authenticate } from '../middleware/auth.js';
import { sendPasswordResetEmail, sendVerificationEmailGraph } from '../services/emailService.js';
import crypto from 'crypto';

const router = express.Router();
// Add this near the top of your backend entry point
console.log('CLIENT_URL at startup:', process.env.CLIENT_URL);

// Register with email/password
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, company, phone } = req.body;

    // Validation
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({
        error: 'Email, password, first name, and last name are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters long'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists with this email' });
    }


    // Generate email verification token
    const emailVerificationToken = crypto.randomBytes(32).toString('hex');
    const emailVerificationExpires = Date.now() + 60 * 60 * 1000; // 1 hour

    // Create new user
    const user = new User({
      email,
      password,
      firstName,
      lastName,
      company,
      phone,
      emailVerificationToken,
      emailVerificationExpires
    });

    await user.save();

    // Send verification email using Microsoft Graph API
    await sendVerificationEmailGraph(user.email, user.firstName, emailVerificationToken);

    // Only send message, do not log in user
    res.status(201).json({
      message: 'User registered successfully. Please check your email to verify your account.'
    });
    // Email verification route (must be after router is initialized)
    router.get('/verify-email', async (req, res) => {
      try {
        const { token } = req.query;
        if (!token) {
          return res.status(400).json({ error: 'Verification token is required' });
        }
        const user = await User.findOne({
          emailVerificationToken: token,
          emailVerificationExpires: { $gt: Date.now() }
        });
        if (!user) {
          return res.status(400).json({ error: 'Invalid or expired verification token' });
        }
        user.isEmailVerified = true;
        user.emailVerificationToken = undefined;
        user.emailVerificationExpires = undefined;
        await user.save();
        // Redirect to frontend login with verified flag
        const clientUrl = process.env.CLIENT_URL || 'http://localhost:8080';
        return res.redirect(`${clientUrl}/login?verified=1`);
      } catch (error) {
        console.error('Email verification error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login with email/password
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(401).json({ error: 'Account is deactivated' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate token
    const token = generateToken(user._id);

    // Prepare user data
    const userData = {
      _id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      avatar: user.avatar,
      role: user.role,
      company: user.company,
      phone: user.phone,
      isEmailVerified: user.isEmailVerified,
      createdAt: user.createdAt
    };

    res.json({
      message: 'Login successful',
      token,
      user: userData
    });

    // End of try block

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user
router.get('/me', authenticate, async (req, res) => {
  try {
    const userData = {
      _id: req.user._id,
      email: req.user.email,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      fullName: req.user.fullName,
      avatar: req.user.avatar,
      role: req.user.role,
      company: req.user.company,
      phone: req.user.phone,
      isEmailVerified: req.user.isEmailVerified,
      lastLoginAt: req.user.lastLoginAt,
      createdAt: req.user.createdAt
    };

    res.json({ user: userData });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout
router.post('/logout', authenticate, (req, res) => {
  res.json({ message: 'Logout successful' });
});

// Google OAuth routes
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback',
  passport.authenticate('google', { session: false }),
  (req, res) => {
    const token = generateToken(req.user._id);
    // Redirect to frontend with token
    res.redirect(`${process.env.CLIENT_URL}/auth/callback?token=${token}`);
  }
);

// GitHub OAuth routes
router.get('/github',
  passport.authenticate('github', { scope: ['user:email'] })
);

router.get('/github/callback',
  passport.authenticate('github', { session: false }),
  (req, res) => {
    console.log('GitHub user:', req.user);
    if (!req.user) {
      return res.redirect(`${process.env.CLIENT_URL}/auth/callback?error=No user found`);
    }
    const token = generateToken(req.user._id);
    // Redirect to frontend with token
    res.redirect(`${process.env.CLIENT_URL}/auth/callback?token=${token}`);
  }
);

// Forgot password with professional implementation
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    // Input validation
    if (!email) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address' });
    }

    // Normalize email (lowercase, trim)
    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });

    // Always return success message for security (don't reveal if user exists)
    const successMessage = 'If an account with that email exists, a password reset link has been sent.';

    if (!user) {
      // Log the attempt for security monitoring
      console.log(`🔍 Password reset requested for non-existent email: ${normalizedEmail}`);
      return res.json({ message: successMessage });
    }

    // Check if user account is active
    if (!user.isActive) {
      console.log(`⚠️ Password reset requested for inactive account: ${normalizedEmail}`);
      return res.json({ message: successMessage });
    }

    // Rate limiting: Check if a reset was recently requested
    const recentResetTime = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
    if (user.resetPasswordExpires && user.resetPasswordExpires > recentResetTime) {
      console.log(`⏰ Rate limited password reset for: ${normalizedEmail}`);
      return res.status(429).json({
        error: 'Please wait 5 minutes before requesting another password reset'
      });
    }

    // Generate secure reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now

    // Save reset token to user
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpiry;
    await user.save();

    try {
      // Send professional password reset email
      const emailResult = await sendPasswordResetEmail(normalizedEmail, resetToken);

      console.log(`✅ Password reset email sent successfully to ${normalizedEmail}`);
      console.log('Email service response:', emailResult);

      res.json({ message: successMessage });
    } catch (emailError) {
      console.error('❌ Failed to send password reset email:', emailError);

      // Clear the reset token if email sending fails
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      // Return appropriate error message
      if (emailError.message.includes('Authentication failed')) {
        return res.status(500).json({
          error: 'Email service configuration error. Please contact support.'
        });
      } else if (emailError.message.includes('Connection failed')) {
        return res.status(500).json({
          error: 'Unable to send email at this time. Please try again later.'
        });
      }

      return res.status(500).json({
        error: 'Failed to send password reset email. Please try again later.'
      });
    }

  } catch (error) {
    console.error('💥 Forgot password route error:', error);
    res.status(500).json({
      error: 'An unexpected error occurred. Please try again later.'
    });
  }
});

// Reset password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters long'
      });
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        error: 'Invalid or expired reset token'
      });
    }

    // Update password
    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
