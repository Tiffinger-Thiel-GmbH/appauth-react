module.exports = {
  extends: ['@tiffinger-thiel/eslint-config/profile/react'],

  // The following is optional, it speeds up prettier if passed.
  // It should match your react version.
  settings: {
    react: {
      version: '17.0'
    }
  },

  ignorePatterns: ["tools/gitmoji.js", "rollup.config.js"],
};