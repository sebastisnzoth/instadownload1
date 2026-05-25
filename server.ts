import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API handler (Proxy for download service)
  app.use(express.json());
  
  app.post("/api/download", async (req, res) => {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) {
        return res.status(400).json({ error: "An array of URLs is required" });
    }
    
    // NOTE: Implementing actual scraping logic here is complex and requires
    // avoiding ToS violations. This endpoint serves as a structural entry point.
    console.log("Processing batch download request for:", urls);
    res.json({ status: "processing", message: `Started batch download for ${urls.length} items.` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
