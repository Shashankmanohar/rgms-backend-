require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

const updateDB = async () => {
  try {
    const connStr = process.env.MONGODB_URI;
    await mongoose.connect(connStr, { dbName: 'rgms_db' });
    console.log('Connected to MongoDB');

    // Update Solar 4G Camera Pro
    await Product.updateOne(
      { id: "prod-1786088544194" },
      { $set: { image: "/assets/asset-7.jpeg" } }
    );

    // Update Test WiFi Camera
    await Product.updateOne(
      { id: "prod-1786088030889" },
      { $set: { image: "/assets/asset-5.jpeg" } }
    );

    // Update the other Test WiFi Camera
    await Product.updateOne(
      { id: "prod-1786087967465" },
      { $set: { image: "/assets/asset-6.jpeg" } }
    );

    console.log('Updated database products images successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Update error:', err);
    process.exit(1);
  }
};

updateDB();
