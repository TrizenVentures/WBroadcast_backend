import express from 'express';
import Contact from '../models/Contact.js';
import { notifyContactAdded } from '../services/notificationService.js';

const router = express.Router();

// Get all contacts
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, search, status, tags } = req.query;
    
    const query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (status) {
      query.status = status;
    }
    
    if (tags) {
      query.tags = { $in: tags.split(',') };
    }

    const contacts = await Contact.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Contact.countDocuments(query);

    res.json({
      contacts,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get contact by ID
router.get('/:id', async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json(contact);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new contact
router.post('/', async (req, res) => {
  try {
    const contact = new Contact(req.body);
    await contact.save();

    // Notify about new contact (if user is authenticated)
    if (req.user) {
      const io = req.app.get('io');
      await notifyContactAdded(req.user._id, contact, io);
    }

    res.status(201).json(contact);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ error: 'Phone number already exists' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Update contact
router.put('/:id', async (req, res) => {
  try {
    const contact = await Contact.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    
    res.json(contact);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete contact
router.delete('/:id', async (req, res) => {
  try {
    const contact = await Contact.findByIdAndDelete(req.params.id);
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json({ message: 'Contact deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk import contacts
router.post('/bulk-import', async (req, res) => {
  try {
    const { contacts } = req.body;
    
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'Invalid contacts data' });
    }

    const results = {
      imported: 0,
      skipped: 0,
      errors: []
    };

    for (const contactData of contacts) {
      try {
        const existingContact = await Contact.findOne({ phone: contactData.phone });
        if (existingContact) {
          results.skipped++;
          continue;
        }

        const contact = new Contact(contactData);
        await contact.save();
        results.imported++;
      } catch (error) {
        results.errors.push({
          contact: contactData,
          error: error.message
        });
      }
    }

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;