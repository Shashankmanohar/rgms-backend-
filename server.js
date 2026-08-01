require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

const Product = require('./models/Product');
const Admin = require('./models/Admin');
const ContactMessage = require('./models/ContactMessage');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'rgms_super_secret_jwt_key_2026';
const DATA_FILE = path.join(__dirname, 'data', 'products.json');
const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json');

// Middleware
app.use(cors());
app.use(express.json({ limit: '20mb' }));

// Configure Multer memory storage for image uploads
const storage = multer.memoryStorage();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Database Connection Flag
let isMongoConnected = false;

// Connect to MongoDB
const connectDB = async () => {
  try {
    const connStr = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/rgms_db';
    await mongoose.connect(connStr, { serverSelectionTimeoutMS: 3000 });
    isMongoConnected = true;
    console.log(`✅ MongoDB Connected Successfully: ${mongoose.connection.host}`);
    await seedDefaultData();
  } catch (err) {
    isMongoConnected = false;
    console.log(`⚠️ MongoDB Not Available (${err.message}). Using local JSON database file.`);
  }
};
connectDB();

// File Database Fallback Helpers
const readProductsFromFile = () => {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    return [];
  }
};

const writeProductsToFile = (products) => {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(products, null, 2), 'utf8');
  } catch (e) {
    console.error('File write error:', e);
  }
};

// Seed default Admin & Products in MongoDB if empty
const seedDefaultData = async () => {
  if (!isMongoConnected) return;
  try {
    const adminCount = await Admin.countDocuments();
    if (adminCount === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await Admin.create({
        username: 'admin',
        password: hashedPassword,
        email: 'admin@rgms.in'
      });
      console.log('🔑 Default Admin created (Username: admin, Password: admin123)');
    }

    const prodCount = await Product.countDocuments();
    if (prodCount === 0) {
      const fileProds = readProductsFromFile();
      if (fileProds.length > 0) {
        await Product.insertMany(fileProds);
        console.log(`📦 Seeded ${fileProds.length} default products into MongoDB.`);
      }
    }
  } catch (e) {
    console.error('Seeding error:', e.message);
  }
};

// JWT Authentication Middleware for Protecting Admin Routes
const verifyAdminToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No authentication token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token. Please log in again.' });
  }
};

// ================= ADMIN AUTH ROUTES ================= //

// POST /api/admin/login - Authenticate Admin & Issue JWT
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    let isValid = false;
    let adminObj = { username };

    if (isMongoConnected) {
      const dbAdmin = await Admin.findOne({ username });
      if (dbAdmin) {
        isValid = await bcrypt.compare(password, dbAdmin.password);
        adminObj.email = dbAdmin.email;
      }
    }

    // Default hardcoded admin fallback for quick testing
    if (!isValid && username === 'admin' && password === 'admin123') {
      isValid = true;
      adminObj.email = 'admin@rgms.in';
    }

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid username or password credentials.' });
    }

    const token = jwt.sign(
      { username: adminObj.username, role: 'admin', email: adminObj.email },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Admin authentication successful',
      token,
      admin: { username: adminObj.username, email: adminObj.email }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error during authentication: ' + err.message });
  }
});

// GET /api/admin/verify - Verify Token Status
app.get('/api/admin/verify', verifyAdminToken, (req, res) => {
  res.json({ valid: true, admin: req.admin });
});

// ================= CLOUDINARY IMAGE UPLOAD ROUTE ================= //

// POST /api/upload - Upload Image to Cloudinary (or return Base64 URL fallback)
app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    let base64Image = null;
    if (req.file) {
      base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    } else if (req.body.image) {
      base64Image = req.body.image;
    }

    if (!base64Image) {
      return res.status(400).json({ error: 'No image file or image data provided.' });
    }

    // Check if Cloudinary credentials are configured
    const hasCloudinary = process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET && process.env.CLOUDINARY_CLOUD_NAME !== 'rgms_cloud';

    if (hasCloudinary) {
      const uploadResult = await cloudinary.uploader.upload(base64Image, {
        folder: 'rgms_products',
        resource_type: 'image'
      });
      return res.json({
        url: uploadResult.secure_url,
        public_id: uploadResult.public_id,
        source: 'cloudinary'
      });
    } else {
      // Fallback: If Cloudinary keys are default, return base64 or stored URL
      return res.json({
        url: base64Image,
        source: 'local'
      });
    }
  } catch (err) {
    console.error('Cloudinary upload error:', err);
    res.status(500).json({ error: 'Image upload failed: ' + err.message });
  }
});

// ================= PRODUCT REST API ROUTES ================= //

// GET /api/products - Fetch All Products
app.get('/api/products', async (req, res) => {
  try {
    const category = req.query.category;
    let products = [];

    if (isMongoConnected) {
      const filter = category && category !== 'all' ? { category } : {};
      products = await Product.find(filter).sort({ createdAt: -1 });
    } else {
      products = readProductsFromFile();
      if (category && category !== 'all') {
        products = products.filter(p => p.category === category);
      }
    }

    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products: ' + err.message });
  }
});

// GET /api/products/:id - Fetch Single Product
app.get('/api/products/:id', async (req, res) => {
  try {
    let product = null;
    if (isMongoConnected) {
      product = await Product.findOne({ id: req.params.id });
    } else {
      const products = readProductsFromFile();
      product = products.find(p => p.id === req.params.id);
    }

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch product: ' + err.message });
  }
});

// POST /api/products - Create Product (Protected by JWT)
app.post('/api/products', verifyAdminToken, async (req, res) => {
  const { name, category, price, oldPrice, badge, rating, reviews, image, stock, description, features } = req.body;
  if (!name || !price) {
    return res.status(400).json({ error: 'Product title and price are required.' });
  }

  const newProduct = {
    id: `prod-${Date.now()}`,
    name,
    category: category || 'wifi-cameras',
    price: Number(price),
    oldPrice: oldPrice ? Number(oldPrice) : null,
    badge: badge || 'NEW',
    rating: Number(rating) || 5.0,
    reviews: Number(reviews) || 0,
    image: image || '/assets/asset-1.png',
    stock: stock !== undefined ? Number(stock) : 20,
    description: description || 'Official RGMS Smart Security Device with 6 Months Warranty.',
    features: Array.isArray(features) ? features : (features ? [features] : ['Official RGMS Warranty', 'Free Express Shipping Across India'])
  };

  try {
    if (isMongoConnected) {
      await Product.create(newProduct);
    }
    
    // Always sync local JSON file database as well
    const fileProds = readProductsFromFile();
    fileProds.unshift(newProduct);
    writeProductsToFile(fileProds);

    res.status(201).json({ message: 'Product added successfully to inventory', product: newProduct });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save product: ' + err.message });
  }
});

// PUT /api/products/:id - Update Product (Protected by JWT)
app.put('/api/products/:id', verifyAdminToken, async (req, res) => {
  const { id } = req.params;

  try {
    let updatedProduct = null;

    if (isMongoConnected) {
      updatedProduct = await Product.findOneAndUpdate(
        { id },
        { $set: req.body },
        { new: true }
      );
    }

    // Sync local JSON file
    const fileProds = readProductsFromFile();
    const idx = fileProds.findIndex(p => p.id === id);
    if (idx !== -1) {
      fileProds[idx] = { ...fileProds[idx], ...req.body };
      writeProductsToFile(fileProds);
      if (!updatedProduct) updatedProduct = fileProds[idx];
    }

    if (!updatedProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.json({ message: 'Product updated successfully', product: updatedProduct });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update product: ' + err.message });
  }
});

// DELETE /api/products/all - Clear All Products (Protected by JWT)
app.delete('/api/products/all', verifyAdminToken, async (req, res) => {
  try {
    if (isMongoConnected) {
      await Product.deleteMany({});
    }
    writeProductsToFile([]);
    res.json({ message: 'All products deleted successfully from inventory' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear products: ' + err.message });
  }
});

// DELETE /api/products/:id - Delete Product (Protected by JWT)
app.delete('/api/products/:id', verifyAdminToken, async (req, res) => {
  const { id } = req.params;

  try {
    if (isMongoConnected) {
      await Product.deleteOne({ id });
    }

    let fileProds = readProductsFromFile();
    fileProds = fileProds.filter(p => p.id !== id);
    writeProductsToFile(fileProds);

    res.json({ message: 'Product deleted successfully', id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete product: ' + err.message });
  }
});

// ================= CONTACT MESSAGES API ROUTES ================= //

const readMessagesFromFile = () => {
  try {
    if (!fs.existsSync(MESSAGES_FILE)) return [];
    const raw = fs.readFileSync(MESSAGES_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    return [];
  }
};

const writeMessagesToFile = (msgs) => {
  try {
    const dir = path.dirname(MESSAGES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(msgs, null, 2), 'utf8');
  } catch (e) {
    console.error('Messages write error:', e);
  }
};

// POST /api/contact - Public submission from Contact Page
app.post('/api/contact', async (req, res) => {
  const { name, phone, email, subject, message } = req.body;
  if (!name || !phone || !message) {
    return res.status(400).json({ error: 'Name, phone number, and message are required.' });
  }

  const newMessage = {
    id: `msg-${Date.now()}`,
    name: name.trim(),
    phone: phone.trim(),
    email: (email || '').trim(),
    subject: subject || 'General Inquiry',
    message: message.trim(),
    status: 'unread',
    createdAt: new Date().toISOString()
  };

  try {
    if (isMongoConnected) {
      await ContactMessage.create(newMessage);
    }
    const msgs = readMessagesFromFile();
    msgs.unshift(newMessage);
    writeMessagesToFile(msgs);

    res.status(201).json({ message: 'Contact message received successfully', contact: newMessage });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save contact message: ' + err.message });
  }
});

// GET /api/contact - Fetch All Contact Messages for Admin (Protected by JWT)
app.get('/api/contact', verifyAdminToken, async (req, res) => {
  try {
    let msgs = [];
    if (isMongoConnected) {
      msgs = await ContactMessage.find().sort({ createdAt: -1 });
    } else {
      msgs = readMessagesFromFile();
    }
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch contact messages: ' + err.message });
  }
});

// PUT /api/contact/:id/read - Mark message as read (Protected by JWT)
app.put('/api/contact/:id/read', verifyAdminToken, async (req, res) => {
  const { id } = req.params;
  try {
    if (isMongoConnected) {
      await ContactMessage.findOneAndUpdate({ id }, { $set: { status: 'read' } });
    }
    const msgs = readMessagesFromFile();
    const idx = msgs.findIndex(m => m.id === id);
    if (idx !== -1) {
      msgs[idx].status = 'read';
      writeMessagesToFile(msgs);
    }
    res.json({ message: 'Message marked as read', id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update message status: ' + err.message });
  }
});

// DELETE /api/contact/:id - Delete message (Protected by JWT)
app.delete('/api/contact/:id', verifyAdminToken, async (req, res) => {
  const { id } = req.params;
  try {
    if (isMongoConnected) {
      await ContactMessage.deleteOne({ id });
    }
    let msgs = readMessagesFromFile();
    msgs = msgs.filter(m => m.id !== id);
    writeMessagesToFile(msgs);
    res.json({ message: 'Message deleted successfully', id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete message: ' + err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mongoDB: isMongoConnected ? 'connected' : 'offline_fallback',
    time: new Date().toISOString()
  });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 RGMS Express Backend REST API running on http://localhost:${PORT}`);
  console.log(`🔐 JWT Auth Protection & ☁️ Cloudinary Upload & 📩 Contact Messages System Active.`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const FALLBACK_PORT = Number(PORT) + 1;
    console.log(`⚠️ Port ${PORT} busy, starting Express server on http://localhost:${FALLBACK_PORT}`);
    app.listen(FALLBACK_PORT, () => {
      console.log(`🚀 RGMS Express Backend REST API running on http://localhost:${FALLBACK_PORT}`);
      console.log(`🔐 JWT Auth Protection & ☁️ Cloudinary Upload & 📩 Contact Messages System Active.`);
    });
  }
});
