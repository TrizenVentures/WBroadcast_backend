import mongoose from 'mongoose';

const templateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  body: {
    type: String,
    required: true
  },
  variables: [{
    name: String,
    type: {
      type: String,
      enum: ['text', 'number', 'date'],
      default: 'text'
    },
    required: {
      type: Boolean,
      default: false
    }
  }],
  category: {
    type: String,
    enum: ['MARKETING', 'TRANSACTIONAL', 'UTILITY'],
    required: true
  },
  language: {
    type: String,
    default: 'EN'
  },
  status: {
    type: String,
    enum: ['draft', 'pending', 'approved', 'rejected'],
    default: 'draft'
  },
  whatsappTemplateId: {
    type: String,
    unique: true,
    sparse: true
  },
  whatsappTemplateName: {
    type: String,
    required: true // Make this required
  }
}, {
  timestamps: true
});

templateSchema.index({ status: 1 });
templateSchema.index({ category: 1 });

export default mongoose.model('Template', templateSchema);