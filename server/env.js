import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dotenvPath = path.join(__dirname, '../.env');
dotenv.config({ path: dotenvPath });

// Log environment variables for debugging (without exposing sensitive data)
console.log('Environment variables check:');
console.log('WHATSAPP_ACCESS_TOKEN:', process.env.WHATSAPP_ACCESS_TOKEN ? 'SET' : 'MISSING');
console.log('WHATSAPP_PHONE_NUMBER_ID:', process.env.WHATSAPP_PHONE_NUMBER_ID ? 'SET' : 'MISSING');
console.log('WHATSAPP_BUSINESS_ACCOUNT_ID:', process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ? 'SET' : 'MISSING');