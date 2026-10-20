import { buildApp } from './app.js';

const PORT = process.env.PORT || 4000;
buildApp().listen(PORT, '127.0.0.1', () => {
  console.log(`treeline server on http://127.0.0.1:${PORT}`);
});
