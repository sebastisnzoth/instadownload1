import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API handler (Proxy for download service)
  app.use(express.json());
  
  app.post("/api/download", async (req, res) => {
    const { urls, startDate, endDate } = req.body;
    if (!urls || !Array.isArray(urls)) {
        return res.status(400).json({ error: "An array of URLs is required" });
    }
    
    // NOTE: Implementing actual scraping logic here is complex and requires
    // avoiding ToS violations. This endpoint serves as a structural entry point.
    console.log(`Processing batch download request for ${urls.length} URLs. Filters - Start Date: ${startDate || 'none'}, End Date: ${endDate || 'none'}`);
    res.json({ status: "processing", message: `Started batch download for ${urls.length} items.` });
  });

  app.post("/api/download-location", async (req, res) => {
    const { lat, lng, limit } = req.body;
    if (lat === undefined || lng === undefined) {
        return res.status(400).json({ error: "Latitude and longitude are required" });
    }
    
    console.log(`Processing location download request for lat: ${lat}, lng: ${lng}, limit: ${limit}`);
    
    const mockResults = Array.from({ length: Math.min(limit || 10, 5) }).map((_, i) => ({
      url: `https://www.instagram.com/p/location_mock_${Math.random().toString(36).substring(7)}/`,
      lat,
      lng
    }));

    res.json({ status: "success", items: mockResults });
  });

  app.post("/api/validate-urls", async (req, res) => {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: "URLs are required" });
    }
    
    try {
      const results = await Promise.all(urls.map(async (url) => {
        try {
          // Attempting a simple HEAD request. This is a best-effort structural check to see
          // if we get blocked or a 404 (non-existent/private).
          const response = await fetch(url, { 
             method: 'HEAD',
             headers: {
                 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
             }
          });
          
          if (response.ok || response.status === 302 || response.status === 301) {
             return { url, isValid: true, isPublic: true };
          } else {
             return { url, isValid: false, isPublic: false };
          }
        } catch (e) {
          return { url, isValid: false, isPublic: false };
        }
      }));
      
      res.json({ results });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Validation failed" });
    }
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
