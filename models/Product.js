const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  category: { type: String, default: 'wifi-cameras' },
  price: { type: Number, default: null },
  oldPrice: { type: Number, default: null },
  badge: { type: String, default: 'NEW' },
  rating: { type: Number, default: 5.0 },
  reviews: { type: Number, default: 0 },
  image: { type: String, default: '/assets/asset-1.png' },
  stock: { type: Number, default: 20 },
  description: { type: String, default: 'Official RGMS Smart Security Device with 6 Months Warranty.' },
  features: [{ type: String }],
  isDeal: { type: Boolean, default: false },
  isNewArrival: { type: Boolean, default: true },
  isBestSeller: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Product', productSchema);
