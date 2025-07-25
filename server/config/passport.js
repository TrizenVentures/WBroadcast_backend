import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import User from '../models/User.js';

// console.log('passport logs : TWILIO_ACCOUNT_SID after dotenv:', process.env.TWILIO_ACCOUNT_SID);

// // Add these lines for debugging
// console.log('Environment variables debug:');
// console.log('GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'SET' : 'UNDEFINED');
// console.log('GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? 'SET' : 'UNDEFINED');
// console.log('First 10 chars of GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID?.substring(0, 10));

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key';

// JWT Strategy - Always active
passport.use(new JwtStrategy({
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: JWT_SECRET
}, async (payload, done) => {
  try {
    const user = await User.findById(payload.userId).select('-password');
    if (user) {
      return done(null, user);
    }
    return done(null, false);
  } catch (error) {
    return done(error, false);
  }
}));

// Helper function to check if OAuth credentials are valid
const isValidOAuthConfig = (clientId, clientSecret) => {
  // console.log(clientId, clientSecret);
  return clientId &&
    clientSecret &&
    !clientId.includes('your-') &&
    !clientSecret.includes('your-');
};

// Initialize OAuth strategies only if valid credentials exist
export const initializeOAuthStrategies = async () => {
  console.log('Initializing OAuth strategies...');
  console.log('Environment check - GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'SET' : 'UNDEFINED');
  console.log('Environment check - GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? 'SET' : 'UNDEFINED');

  // Google OAuth Strategy
  // Use a full https callback URL from env for production compliance
  if (isValidOAuthConfig(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET)) {
    try {
      const { Strategy: GoogleStrategy } = await import('passport-google-oauth20');
      passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        // Use GOOGLE_CALLBACK_URL env variable, fallback to relative path for dev
        callbackURL: process.env.GOOGLE_CALLBACK_URL || "/api/auth/google/callback"
      }, async (accessToken, refreshToken, profile, done) => {
        try {
          let user = await User.findOne({ googleId: profile.id });
          if (user) {
            await user.updateLastLogin();
            return done(null, user);
          }
          user = await User.findOne({ email: profile.emails[0].value });
          if (user) {
            user.googleId = profile.id;
            user.avatar = profile.photos[0]?.value;
            user.isEmailVerified = true;
            await user.save();
            await user.updateLastLogin();
            return done(null, user);
          }
          user = new User({
            googleId: profile.id,
            email: profile.emails[0].value,
            firstName: profile.name.givenName,
            lastName: profile.name.familyName,
            avatar: profile.photos[0]?.value,
            isEmailVerified: true
          });
          await user.save();
          await user.updateLastLogin();
          done(null, user);
        } catch (error) {
          done(error, null);
        }
      }));
      console.log('Google OAuth strategy initialized');
    } catch (error) {
      console.warn('Failed to initialize Google OAuth strategy:', error.message);
    }
  } else {
    console.log('Google OAuth credentials not configured - strategy disabled');
  }
  // NOTE: Set GOOGLE_CALLBACK_URL in your .env to the full https callback, e.g.
  // GOOGLE_CALLBACK_URL=https://wboardcast-backend.llp.trizenventures.com/api/auth/google/callback

  // GitHub OAuth Strategy
  // Use a full https callback URL from env for production compliance
  if (isValidOAuthConfig(process.env.GITHUB_CLIENT_ID, process.env.GITHUB_CLIENT_SECRET)) {
    try {
      const { Strategy: GitHubStrategy } = await import('passport-github2');
      passport.use(new GitHubStrategy({
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        // Use GITHUB_CALLBACK_URL env variable, fallback to relative path for dev
        callbackURL: process.env.GITHUB_CALLBACK_URL || "/api/auth/github/callback"
      }, async (accessToken, refreshToken, profile, done) => {
        try {
          let user = await User.findOne({ githubId: profile.id });
          if (user) {
            await user.updateLastLogin();
            return done(null, user);
          }
          const email = profile.emails?.[0]?.value;
          if (email) {
            user = await User.findOne({ email });
            if (user) {
              user.githubId = profile.id;
              user.avatar = profile.photos[0]?.value;
              user.isEmailVerified = true;
              await user.save();
              await user.updateLastLogin();
              return done(null, user);
            }
          }
          const names = profile.displayName?.split(' ') || ['', ''];
          user = new User({
            githubId: profile.id,
            email: email || `${profile.username}@github.local`,
            firstName: names[0] || profile.username,
            lastName: (names.slice(1).join(' ') && names.slice(1).join(' ').trim() !== '') ? names.slice(1).join(' ') : 'GitHub',
            avatar: profile.photos[0]?.value,
            isEmailVerified: !!email
          });
          await user.save();
          await user.updateLastLogin();
          done(null, user);
        } catch (error) {
          done(error, null);
        }
      }));
      console.log('GitHub OAuth strategy initialized');
    } catch (error) {
      console.warn('Failed to initialize GitHub OAuth strategy:', error.message);
    }
  } else {
    console.log('GitHub OAuth credentials not configured - strategy disabled');
  }
  // NOTE: Set GITHUB_CALLBACK_URL in your .env to the full https callback, e.g.
  // GITHUB_CALLBACK_URL=https://wboardcast-backend.llp.trizenventures.com/api/auth/github/callback
};

// Session serialization
passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).select('-password');
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

export default passport;
