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

// Middleware
app.use(cors({
  origin: [
    'https://rgms-frontend-9s7u.vercel.app',
    'https://rgms-backend.vercel.app',
    'https://www.rgmservices.in',
    'https://rgmservices.in',
    'http://localhost:3000',
    'http://localhost:3001',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors());
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
let mongoError = null;
let dbConnectionPromise = null;

// Connect to MongoDB
const connectDB = () => {
  const FALLBACK_MONGODB_URI = 'mongodb+srv://shashankmanohar1734_db_user:Shashankjee123@rgms-2.gm3a3hn.mongodb.net/rgms_db?retryWrites=true&w=majority&appName=RGMS-2';
  let connStr = process.env.MONGODB_URI;

  const tryConnect = (uri, isFallback = false) => {
    return mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 })
      .then(async () => {
        isMongoConnected = true;
        mongoError = null;
        console.log(`✅ MongoDB Connected Successfully: ${mongoose.connection.host}`);
        await seedDefaultData();
      })
      .catch((err) => {
        if (!isFallback && uri !== FALLBACK_MONGODB_URI) {
          console.log(`⚠️ MongoDB connection failed (${err.message}). Retrying with fallback connection string...`);
          dbConnectionPromise = tryConnect(FALLBACK_MONGODB_URI, true);
          return dbConnectionPromise;
        } else {
          isMongoConnected = false;
          mongoError = err.message;
          console.log(`⚠️ MongoDB Connection Failed: ${err.message}`);
        }
      });
  };

  if (!connStr) {
    console.log('⚠️ MONGODB_URI env var is missing. Using fallback connection string.');
    connStr = FALLBACK_MONGODB_URI;
  }

  dbConnectionPromise = tryConnect(connStr, connStr === FALLBACK_MONGODB_URI);
};
connectDB();

// Database Connection Enforcement Middleware
const requireMongoDB = async (req, res, next) => {
  if (req.path === '/health') {
    return next();
  }
  if (dbConnectionPromise) {
    try {
      await dbConnectionPromise;
    } catch (e) {
      // ignore connection error here, it is handled below
    }
  }
  if (!isMongoConnected) {
    return res.status(503).json({
      error: 'Database connection is offline. Please make sure MONGODB_URI is correctly configured and the database is accessible.',
      details: mongoError
    });
  }
  next();
};
app.use('/api', requireMongoDB);

// Seed default Admin & cleanup default products in MongoDB
const seedDefaultData = async () => {
  if (!isMongoConnected) return;
  try {
    const adminCount = await Admin.countDocuments();
    const hashedPassword = await bcrypt.hash('rgmsadmin', 10);
    if (adminCount === 0) {
      await Admin.create({
        username: 'admin',
        password: hashedPassword,
        email: 'rgmsadmin@gmail.com'
      });
      console.log('🔑 Default Admin created (Username: admin, Password: rgmsadmin)');
    } else {
      await Admin.updateOne({ username: 'admin' }, { password: hashedPassword, email: 'rgmsadmin@gmail.com' });
      console.log('🔑 Default Admin password updated/reset to "rgmsadmin"');
    }

    // Delete default products from MongoDB if present
    const defaultIds = ["prod-1786178881952", "prod-1786088544194", "prod-1786088030889", "prod-1786087967465"];
    const deleteResult = await Product.deleteMany({ id: { $in: defaultIds } });
    if (deleteResult.deletedCount > 0) {
      console.log(`🧹 Deleted ${deleteResult.deletedCount} default products from MongoDB.`);
    }
  } catch (e) {
    console.error('Seeding/cleanup error:', e.message);
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

    const dbAdmin = await Admin.findOne({
      $or: [{ username: username }, { email: username }]
    });
    if (dbAdmin) {
      isValid = await bcrypt.compare(password, dbAdmin.password);
      adminObj.username = dbAdmin.username;
      adminObj.email = dbAdmin.email;
    }

    // Default hardcoded admin fallback for quick testing
    if (!isValid && (username === 'admin' || username === 'rgmsadmin@gmail.com') && (password === 'rgmsadmin' || password === 'rgmsadmin@gmail.com')) {
      isValid = true;
      adminObj.username = 'admin';
      adminObj.email = 'rgmsadmin@gmail.com';
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
    const filter = category && category !== 'all' ? { category } : {};
    const products = await Product.find(filter).sort({ createdAt: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products: ' + err.message });
  }
});

// GET /api/products/:id - Fetch Single Product
app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findOne({ id: req.params.id });
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
  const { name, category, price, oldPrice, badge, rating, reviews, image, stock, description, features, isDeal, isNewArrival, isBestSeller } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Product title is required.' });
  }

  const newProduct = {
    id: `prod-${Date.now()}`,
    name,
    category: category || 'wifi-cameras',
    price: price !== undefined && price !== null && price !== '' ? Number(price) : null,
    oldPrice: oldPrice ? Number(oldPrice) : null,
    badge: badge || 'NEW',
    rating: Number(rating) || 5.0,
    reviews: Number(reviews) || 0,
    image: image || '/assets/asset-1.png',
    stock: stock !== undefined ? Number(stock) : 20,
    description: description || 'Official RGMS Smart Security Device.',
    features: Array.isArray(features) ? features : (features ? [features] : ['Dedicated Tech Support']),
    isDeal: isDeal !== undefined ? Boolean(isDeal) : false,
    isNewArrival: isNewArrival !== undefined ? Boolean(isNewArrival) : true,
    isBestSeller: isBestSeller !== undefined ? Boolean(isBestSeller) : false
  };

  try {
    const createdProduct = await Product.create(newProduct);
    res.status(201).json({ message: 'Product added successfully to inventory', product: createdProduct });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save product: ' + err.message });
  }
});

// PUT /api/products/:id - Update Product (Protected by JWT)
app.put('/api/products/:id', verifyAdminToken, async (req, res) => {
  const { id } = req.params;

  try {
    const updatedProduct = await Product.findOneAndUpdate(
      { id },
      { $set: req.body },
      { new: true }
    );

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
    await Product.deleteMany({});
    res.json({ message: 'All products deleted successfully from inventory' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear products: ' + err.message });
  }
});

// DELETE /api/products/:id - Delete Product (Protected by JWT)
app.delete('/api/products/:id', verifyAdminToken, async (req, res) => {
  const { id } = req.params;

  try {
    const deleteResult = await Product.deleteOne({ id });
    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json({ message: 'Product deleted successfully', id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete product: ' + err.message });
  }
});

// ================= CONTACT MESSAGES API ROUTES ================= //

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
    const createdMsg = await ContactMessage.create(newMessage);
    res.status(201).json({ message: 'Contact message received successfully', contact: createdMsg });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save contact message: ' + err.message });
  }
});

// GET /api/contact - Fetch All Contact Messages for Admin (Protected by JWT)
app.get('/api/contact', verifyAdminToken, async (req, res) => {
  try {
    const msgs = await ContactMessage.find().sort({ createdAt: -1 });
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch contact messages: ' + err.message });
  }
});

// PUT /api/contact/:id/read - Mark message as read (Protected by JWT)
app.put('/api/contact/:id/read', verifyAdminToken, async (req, res) => {
  const { id } = req.params;
  try {
    const updatedMsg = await ContactMessage.findOneAndUpdate({ id }, { $set: { status: 'read' } }, { new: true });
    if (!updatedMsg) {
      return res.status(404).json({ error: 'Message not found' });
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
    const deleteResult = await ContactMessage.deleteOne({ id });
    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    res.json({ message: 'Message deleted successfully', id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete message: ' + err.message });
  }
});

// Root welcome route
app.get('/', (req, res) => {
  res.send('Hello from RGMS Backend!');
});

app.get('/api', (req, res) => {
  res.json({ message: 'Hello from RGMS Backend!' });
});

// Health check
app.get('/api/health', async (req, res) => {
  if (dbConnectionPromise) {
    try {
      await dbConnectionPromise;
    } catch (e) {
      // ignore rejection, it is handled in catch block
    }
  }
  res.json({
    message: 'Hello from RGMS Backend!',
    status: 'ok',
    mongoDB: isMongoConnected ? 'connected' : 'offline_fallback',
    mongoError: mongoError,
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
