// Tiny zero-dependency static server for the birthday page.
// Railway sets PORT; everything routes to index.html.
const http = require("http");
const fs = require("fs");
const path = require("path");

const page = fs.readFileSync(path.join(__dirname, "index.html"));
const port = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    });
    res.end(page);
  })
  .listen(port, () => console.log(`Birthday page ready on port ${port}`));
