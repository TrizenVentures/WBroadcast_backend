import Bull from 'bull';
import Redis from 'redis';
import Campaign from '../models/Campaign.js';
import { sendCampaignMessages } from './whatsappService.js';

let campaignQueue;
let redisClient;

export const initializeScheduler = async (io) => {
  try {
    // Build Redis URL for debug (mask password)
    const redisUrl = `redis://:${process.env.REDIS_PASSWORD}@${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`;
    const maskedRedisUrl = redisUrl.replace(`:${process.env.REDIS_PASSWORD}@`, ':*****@');
    // console.log('[DEBUG] Redis URL for node-redis:', maskedRedisUrl); // dev-only logging commented out

    // Initialize Redis client with TLS/SSL for Redis Cloud
    redisClient = Redis.createClient({
      url: redisUrl
    });


    // Add error handling for Redis client
    redisClient.on('error', (err) => {
      console.error('[Redis Client Error]', err);
      // Optionally, you can implement reconnection logic here
    });
    redisClient.on('end', () => {
      console.warn('[Redis Client] Connection closed');
    });

    await redisClient.connect();
    console.log('Connected to Redis (TLS/SSL enabled)');

    // Debug Bull queue Redis URL
    // console.log('[DEBUG] Redis URL for Bull queue:', maskedRedisUrl); // dev-only logging commented out

    // Initialize Bull queue with Redis Cloud using host/port/password for ioredis compatibility
    campaignQueue = new Bull('campaign queue', {
      redis: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT),
        password: process.env.REDIS_PASSWORD,
        db: 0
      }
    });

    // Add error logging for Bull queue
    // # campaignQueue.on('error', (err) => {
    // #   console.error('[Bull Queue Error]', err);
    // #
    // }); // dev-only error logging commented out

    // Process campaign jobs
    campaignQueue.process('send-campaign', async (job) => {
      const { campaignId } = job.data;
      console.log(`Processing campaign: ${campaignId}`);

      try {
        const campaign = await Campaign.findById(campaignId);
        if (!campaign) {
          throw new Error(`Campaign ${campaignId} not found`);
        }

        if (campaign.status !== 'scheduled') {
          console.log(`Campaign ${campaignId} is not scheduled, current status: ${campaign.status}`);
          return;
        }

        // Update campaign status to sending
        campaign.status = 'sending';
        await campaign.save();

        // Emit status update
        io.emit('campaign-status-update', {
          campaignId: campaign._id,
          status: 'sending',
          progress: campaign.progress
        });

        // Send campaign messages using WhatsApp Cloud API
        await sendCampaignMessages(campaign, io);

        console.log(`Campaign ${campaignId} completed successfully using WhatsApp Cloud API`);
      } catch (error) {
        console.error(`Error processing campaign ${campaignId}:`, error);

        // Update campaign status to failed
        const campaign = await Campaign.findById(campaignId);
        if (campaign) {
          campaign.status = 'failed';
          await campaign.save();

          io.emit('campaign-status-update', {
            campaignId: campaign._id,
            status: 'failed',
            error: error.message
          });
        }

        throw error;
      }
    });

    // Schedule existing campaigns
    await scheduleExistingCampaigns();

    console.log('Campaign scheduler initialized');
  } catch (error) {
    console.error('Failed to initialize scheduler:', error);
  }
};

const determineProvider = (campaign) => {
  // Check for WhatsApp Cloud API credentials
  const hasWhatsAppCredentials = process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!hasWhatsAppCredentials) {
    throw new Error('WhatsApp Cloud API credentials not configured. Please set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID environment variables.');
  }

  return 'whatsapp';
};

export const scheduleCampaign = async (campaign) => {
  try {
    const delay = new Date(campaign.scheduledAt).getTime() - Date.now();

    if (delay <= 0) {
      // Schedule immediately if time has passed
      const job = await campaignQueue.add('send-campaign', {
        campaignId: campaign._id.toString()
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      });

      campaign.jobId = job.id.toString();
    } else {
      // Schedule for future
      const job = await campaignQueue.add('send-campaign', {
        campaignId: campaign._id.toString()
      }, {
        delay,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      });

      campaign.jobId = job.id.toString();
    }

    await campaign.save();
    console.log(`Campaign ${campaign._id} scheduled with job ID: ${campaign.jobId}`);

    return campaign.jobId;
  } catch (error) {
    console.error('Error scheduling campaign:', error);
    throw error;
  }
};

export const cancelCampaign = async (campaignId) => {
  try {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign || !campaign.jobId) {
      throw new Error('Campaign or job not found');
    }

    // Remove job from queue
    const job = await campaignQueue.getJob(campaign.jobId);
    if (job) {
      await job.remove();
    } else {
      console.log(`Job ${campaign.jobId} not found in queue, may have already been processed or removed`);
    }

    // Update campaign status
    campaign.status = 'cancelled';
    campaign.jobId = null;
    await campaign.save();

    console.log(`Campaign ${campaignId} cancelled`);
    return true;
  } catch (error) {
    console.error('Error cancelling campaign:', error);
    throw error;
  }
};

export const rescheduleCampaign = async (campaignId, newScheduledAt) => {
  try {
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      throw new Error('Campaign not found');
    }

    // Cancel existing job if it exists
    if (campaign.jobId) {
      await cancelCampaign(campaignId);
    }

    // Update scheduled time
    campaign.scheduledAt = newScheduledAt;
    campaign.status = 'scheduled';

    // Schedule new job
    await scheduleCampaign(campaign);

    console.log(`Campaign ${campaignId} rescheduled for ${newScheduledAt}`);
    return campaign;
  } catch (error) {
    console.error('Error rescheduling campaign:', error);
    throw error;
  }
};

const scheduleExistingCampaigns = async () => {
  try {
    const scheduledCampaigns = await Campaign.find({
      status: 'scheduled',
      scheduledAt: { $gte: new Date() }
    });

    for (const campaign of scheduledCampaigns) {
      if (!campaign.jobId) {
        await scheduleCampaign(campaign);
      }
    }

    console.log(`Scheduled ${scheduledCampaigns.length} existing campaigns`);
  } catch (error) {
    console.error('Error scheduling existing campaigns:', error);
  }
};

export { campaignQueue };
