import mongoose from 'mongoose';

const responseSchema = new mongoose.Schema({
  // WhatsApp message details
  whatsappMessageId: {
    type: String,
    required: true,
    unique: true
  },
  fromPhone: {
    type: String,
    required: true,
    trim: true
  },
  
  // Response content
  responseType: {
    type: String,
    enum: ['text', 'button', 'interactive', 'media'],
    required: true
  },
  responseContent: {
    type: String,
    required: true
  },
  
  // Context linking
  originalCampaignId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign',
    sparse: true
  },
  originalMessageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    sparse: true
  },
  contactId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Contact',
    required: true
  },
  
  // Button-specific data
  buttonPayload: {
    type: String,
    sparse: true
  },
  buttonText: {
    type: String,
    sparse: true
  },
  
  // Processing status
  processed: {
    type: Boolean,
    default: false
  },
  processedAt: {
    type: Date
  },
  
  // n8n integration
  n8nWorkflowTriggered: {
    type: Boolean,
    default: false
  },
  n8nWorkflowId: {
    type: String,
    sparse: true
  },
  n8nResponseSent: {
    type: Boolean,
    default: false
  },
  
  // Auto-response tracking
  autoResponseSent: {
    type: Boolean,
    default: false
  },
  autoResponseMessageId: {
    type: String,
    sparse: true
  },
  
  // Raw webhook data for debugging
  rawWebhookData: {
    type: Object
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
responseSchema.index({ whatsappMessageId: 1 });
responseSchema.index({ fromPhone: 1, createdAt: -1 });
responseSchema.index({ originalCampaignId: 1 });
responseSchema.index({ contactId: 1 });
responseSchema.index({ processed: 1 });
responseSchema.index({ n8nWorkflowTriggered: 1 });

export default mongoose.model('Response', responseSchema);