module.exports = {
  presets: ["babel-preset-expo"],
  // Eve uses `await using`; transform it before Expo lowers async functions.
  plugins: ["@babel/plugin-transform-explicit-resource-management"],
};
