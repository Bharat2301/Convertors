if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ debug: true });
}

const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');
const cors = require('cors');
const { optimize } = require('svgo');
const sevenZip = require('node-7z');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const tmp = require('tmp');
const { fromPath } = require('pdf2pic');
const PDFDocument = require('pdfkit');

// Log FFmpeg availability
try {
  ffmpeg.getAvailableFormats((err, formats) => {
    if (err) {
      console.error('FFmpeg not found or misconfigured:', err.message);
    } else {
      console.log('FFmpeg available. Supported formats:', Object.keys(formats).slice(0, 10), '...');
    }
  });
} catch (err) {
  console.error('Error checking FFmpeg:', err.message);
}

const app = express();
const port = process.env.PORT || 5001;

// Log environment variables
console.log('Environment variables:', {
  PORT: process.env.PORT,
  FRONTEND_URL: process.env.FRONTEND_URL,
  CONVERSION_TIMEOUT: process.env.CONVERSION_TIMEOUT,
  HOME: process.env.HOME,
  USER: process.env.USER,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR
});

// Enhanced CORS configuration
app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      'http://localhost:5173',
      process.env.FRONTEND_URL || 'https://convertors-frontend.onrender.com'
    ].filter(Boolean);
    console.log(`CORS: Request from origin ${origin || 'undefined'}`);
    if (!origin || allowedOrigins.includes(origin)) {
      console.log(`CORS: Allowing origin ${origin || 'undefined'}`);
      callback(null, true);
    } else {
      console.warn(`CORS: Blocking origin ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204,
}));

app.options('*', cors());

// Use /app for Render's filesystem
const uploadsDir = path.join('/app', 'Uploads');
const convertedDir = path.join('/app', 'converted');
const tempDir = path.join('/app', 'tmp');

// Verify directory permissions at startup
(async () => {
  try {
    // Ensure directories exist and are accessible
    const dirs = [uploadsDir, convertedDir, tempDir, '/app/tmp/officeuser-runtime'];
    for (const dir of dirs) {
      await fsPromises.mkdir(dir, { recursive: true });
      try {
        // Attempt to set permissions, but don't fail if it errors
        await execPromise(`chmod -R 775 ${dir}`);
        console.log(`Set permissions for: ${dir}`);
      } catch (permErr) {
        console.warn(`Failed to set permissions for ${dir}: ${permErr.message}. Continuing with verification.`);
      }
      // Verify read/write access
      try {
        await fsPromises.access(dir, fs.constants.R_OK | fs.constants.W_OK);
        console.log(`Directory verified: ${dir}`);
      } catch (accessErr) {
        console.warn(`Directory access warning: ${dir} - ${accessErr.message}. Attempting to continue.`);
      }
    }
  } catch (err) {
    console.error('Error setting up directories:', err.message);
    // Log error but do not exit to allow the server to continue running
  }
})();

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allFormats = [
      'bmp', 'eps', 'gif', 'ico', 'png', 'svg', 'tga', 'tiff', 'wbmp', 'webp', 'jpg', 'jpeg',
      'pdf', 'txt', 'rtf', 'odt',
      'mp3', 'wav', 'aac', 'flac', 'ogg', 'opus', 'wma', 'aiff', 'm4v', 'mmf', '3g2',
      'mp4', 'avi', 'mov', 'webm', 'mkv', 'flv', 'wmv',
      'zip', '7z',
      'epub', 'mobi', 'azw3',
    ];
    const allowedExtensions = allFormats.map(ext => `.${ext}`);
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      console.log(`File accepted: ${file.originalname} (${ext}, ${file.size} bytes)`);
      cb(null, true);
    } else {
      console.error(`Unsupported file type: ${ext} for ${file.originalname}`);
      cb(new Error(`Unsupported file type: ${ext}. Supported types: ${allFormats.join(', ')}`), false);
    }
  },
});

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`Route requested: ${req.method} ${req.originalUrl}`, {
    params: req.params,
    query: req.query,
    body: req.body
  });
  next();
});

// Register routes with logging
const routes = [
  { method: 'get', path: '/health' },
  { method: 'get', path: '/status' },
  { method: 'post', path: '/api/convert' },
  { method: 'get', path: '/converted/:filename' },
  { method: 'delete', path: '/api/delete/:filename' },
];

routes.forEach(({ method, path }) => {
  console.log(`Registering route: ${method.toUpperCase()} ${path}`);
});

app.get('/health', (req, res) => {
  console.log('Health check requested from:', req.get('origin'));
  res.status(200).json({ status: 'OK' });
});

app.get('/status', async (req, res) => {
  console.log('Status check requested from:', req.get('origin'));
  const checks = [
    {
      name: 'FFmpeg',
      check: () => new Promise((resolve) => {
        exec('ffmpeg -version', (err, stdout, stderr) => {
          if (err) {
            console.error('FFmpeg check failed:', err.message, stderr);
            return resolve({ name: 'FFmpeg', status: 'Failed', details: err.message });
          }
          console.log('FFmpeg version:', stdout.split('\n')[0]);
          resolve({ name: 'FFmpeg', status: 'OK', details: stdout.split('\n')[0] });
        });
      }),
    },
    {
      name: 'Ghostscript',
      check: () => new Promise((resolve) => {
        exec('gs --version', (err, stdout, stderr) => {
          if (err) {
            console.error('Ghostscript check failed:', err.message, stderr);
            return resolve({ name: 'Ghostscript', status: 'Failed', details: err.message });
          }
          console.log('Ghostscript version:', stdout.split('\n')[0]);
          resolve({ name: 'Ghostscript', status: 'OK', details: stdout.split('\n')[0] });
        });
      }),
    },
    {
      name: 'Calibre',
      check: () => new Promise((resolve) => {
        exec('ebook-convert --version', (err, stdout, stderr) => {
          if (err) {
            console.error('Calibre check failed:', err.message, stderr);
            return resolve({ name: 'Calibre', status: 'Failed', details: err.message });
          }
          console.log('Calibre version:', stdout.split('\n')[0]);
          resolve({ name: 'Calibre', status: 'OK', details: stdout.split('\n')[0] });
        });
      }),
    },
  ];

  Promise.all(checks.map(c => c.check())).then(results => {
    res.status(200).json({ status: 'OK', dependencies: results });
  });
});

const allFormats = [
  'bmp', 'eps', 'gif', 'ico', 'png', 'svg', 'tga', 'tiff', 'wbmp', 'webp', 'jpg', 'jpeg',
  'pdf', 'txt', 'rtf', 'odt',
  'mp3', 'wav', 'aac', 'flac', 'ogg', 'opus', 'wma', 'aiff', 'm4v', 'mmf', '3g2',
  'mp4', 'avi', 'mov', 'webm', 'mkv', 'flv', 'wmv',
  'zip', '7z',
  'epub', 'mobi', 'azw3',
];

const supportedFormats = {
  image: allFormats,
  compressor: ['jpg', 'png', 'svg'],
  pdfs: ['jpg', 'png', 'gif'],
  audio: allFormats,
  video: allFormats,
  archive: allFormats,
  ebook: allFormats,
};

// Sanitize filename to prevent invalid characters
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9-_.]/g, '') // Remove invalid characters
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .slice(0, 100); // Limit filename length
};

app.post('/api/convert', upload.array('files', 5), async (req, res) => {
  console.log('Received /api/convert request from:', req.get('origin'), {
    files: req.files ? req.files.map(f => ({ name: f.originalname, size: f.size, path: f.path })) : [],
    formats: req.body.formats,
  });
  let tempFiles = req.files ? req.files.map(f => f.path) : [];
  try {
    const files = req.files;
    let formats;
    try {
      formats = JSON.parse(req.body.formats || '[]');
    } catch (parseError) {
      console.error('Error parsing formats:', parseError);
      return res.status(400).json({ error: 'Invalid formats data. Please provide valid JSON.' });
    }
    if (!files || files.length === 0) {
      console.error('No files uploaded');
      return res.status(400).json({ error: 'No files uploaded.' });
    }
    if (files.length > 5) {
      console.error('Too many files uploaded');
      return res.status(400).json({ error: 'Maximum 5 files allowed.' });
    }
    if (files.length !== formats.length) {
      console.error(`Mismatch between files (${files.length}) and formats (${formats.length})`);
      return res.status(400).json({
        error: `Mismatch between files and formats. Files: ${files.length}, Formats: ${formats.length}`,
      });
    }
    const outputFiles = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const formatInfo = formats[i];
      const inputExt = path.extname(file.originalname).toLowerCase().slice(1) || 'unknown';
      const outputExt = formatInfo.target.toLowerCase().split(' ')[0];
      console.log(`Processing file: ${file.originalname}, type: ${formatInfo.type}, inputExt: ${inputExt}, target: ${outputExt}`);
      if (!Object.keys(supportedFormats).includes(formatInfo.type)) {
        throw new Error(`Unsupported conversion type: ${formatInfo.type}. Supported types: ${Object.keys(supportedFormats).join(', ')}`);
      }
      if (!supportedFormats[formatInfo.type].includes(outputExt)) {
        throw new Error(`Unsupported output format: ${outputExt} for type ${formatInfo.type}. Supported formats: ${supportedFormats[formatInfo.type].join(', ')}`);
      }
      if (!allFormats.includes(inputExt)) {
        throw new Error(`Unsupported input format: ${inputExt}. Supported formats: ${allFormats.join(', ')}`);
      }
      const inputPath = file.path;
      const outputPath = path.join(
        convertedDir,
        `${sanitizeFilename(path.basename(file.originalname, path.extname(file.originalname)))}_${Date.now()}.${outputExt}`
      );
      try {
        await fsPromises.access(inputPath);
      } catch {
        throw new Error(`Input file not found: ${file.originalname}`);
      }
      const outputType = ['bmp', 'eps', 'gif', 'ico', 'png', 'svg', 'tga', 'tiff', 'wbmp', 'webp', 'jpg', 'jpeg'].includes(outputExt) ? 'image' :
        ['pdf', 'txt', 'rtf', 'odt'].includes(inputExt) && outputExt === 'pdf' ? 'pdfs' :
        ['mp3', 'wav', 'aac', 'flac', 'ogg', 'opus', 'wma', 'aiff', 'm4v', 'mmf', '3g2'].includes(outputExt) ? 'audio' :
        ['mp4', 'avi', 'mov', 'webm', 'mkv', 'flv', 'wmv'].includes(outputExt) ? 'video' : formatInfo.type;
      switch (outputType) {
        case 'image':
        case 'compressor':
          await convertImage(inputPath, outputPath, outputExt, formatInfo.subSection);
          break;
        case 'pdfs':
          await convertPdf(inputPath, outputPath, outputExt);
          break;
        case 'audio':
        case 'video':
          await convertMedia(inputPath, outputPath, outputExt, inputExt);
          break;
        case 'archive':
          await convertArchive(inputPath, outputPath, outputExt);
          break;
        case 'ebook':
          await convertEbook(inputPath, outputPath, outputExt);
          break;
        default:
          throw new Error(`Unsupported conversion type: ${outputType}`);
      }
      outputFiles.push({
        path: outputPath,
        name: path.basename(outputPath),
        id: formatInfo.id,
      });
    }
    res.json({
      files: outputFiles.map(file => ({
        name: file.name,
        path: `/converted/${encodeURIComponent(file.name)}`,
        id: file.id,
      })),
    });
  } catch (error) {
    console.error('Conversion error:', { message: error.message, stack: error.stack });
    res.status(500).json({ error: error.message || 'Conversion failed. Please try a different file or check server logs.' });
  } finally {
    await cleanupFiles(tempFiles.filter(file => file.startsWith(uploadsDir)));
  }
});

app.get('/converted/:filename([a-zA-Z0-9-_.]+)', async (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(convertedDir, filename);
  console.log(`Serving file: ${filePath} to ${req.get('origin')}`);
  try {
    await fsPromises.access(filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('Error sending file:', err);
        res.status(500).json({ error: 'Failed to send converted file.' });
      } else {
        console.log(`File sent successfully: ${filePath}`);
      }
    });
  } catch (err) {
    console.error('File not found:', filePath, err);
    res.status(404).json({ error: 'Converted file not found.' });
  }
});

app.delete('/api/delete/:filename([a-zA-Z0-9-_.]+)', async (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(convertedDir, filename);
  console.log(`Delete request for ${filePath} from ${req.get('origin')}`);
  try {
    await cleanupFiles([filePath]);
    res.status(200).json({ message: `File ${filename} deleted successfully.` });
  } catch (err) {
    console.error(`Error deleting file ${filePath}:`, err);
    res.status(500).json({ error: `Failed to delete file ${filename}.` });
  }
});

async function convertImage(inputPath, outputPath, format, subSection) {
  const imageFormats = ['bmp', 'eps', 'gif', 'ico', 'png', 'svg', 'tga', 'tiff', 'wbmp', 'webp', 'jpg', 'jpeg'];
  const inputExt = path.extname(inputPath).toLowerCase().slice(1);
  const sharpSupported = ['bmp', 'gif', 'png', 'tiff', 'webp', 'jpg', 'jpeg'];
  
  if (!imageFormats.includes(inputExt) && ['txt', 'rtf', 'odt'].includes(inputExt)) {
    // Convert text-based files to PDF first
    const tempPdfPath = path.join(tempDir, `temp_${Date.now()}.pdf`);
    try {
      await new Promise((resolve, reject) => {
        exec(`libreoffice --headless --convert-to pdf --outdir ${tempDir} ${inputPath}`, (err, stdout, stderr) => {
          if (err) {
            console.error(`Text to PDF conversion failed: ${err.message}`, stderr);
            return reject(new Error(`Text to PDF conversion failed: ${err.message}`));
          }
          console.log(`Text to PDF conversion completed: ${tempPdfPath}`);
          resolve();
        });
      });
      await convertImage(tempPdfPath, outputPath, format, subSection);
      await fsPromises.unlink(tempPdfPath).catch(err => console.error(`Error cleaning up temp PDF: ${err.message}`));
    } catch (err) {
      console.error(`Image conversion preprocessing failed: ${err.message}`);
      throw err;
    }
    return;
  }
  
  if (imageFormats.includes(format)) {
    if (subSection === 'compressor' && format === 'svg') {
      const svgData = await fsPromises.readFile(inputPath, 'utf-8');
      const result = optimize(svgData, {
        multipass: true,
        plugins: [{ name: 'preset-default' }, { name: 'removeViewBox', active: false }],
      });
      if (result.error) {
        throw new Error(`SVG compression failed: ${result.error}`);
      }
      await fsPromises.writeFile(outputPath, result.data);
      console.log(`SVG compression completed: ${outputPath}`);
    } else if (sharpSupported.includes(format)) {
      let sharpInstance = sharp(inputPath);
      if (subSection === 'compressor') {
        if (format === 'jpg' || format === 'jpeg') {
          sharpInstance = sharpInstance.jpeg({ quality: 80 });
        } else if (format === 'png') {
          sharpInstance = sharpInstance.png({ compressionLevel: 9 });
        }
      }
      await sharpInstance
        .toFormat(format === 'jpg' ? 'jpeg' : format)
        .toFile(outputPath);
      console.log(`Image conversion (Sharp) completed: ${outputPath}`);
    } else {
      throw new Error(`Unsupported image format for Sharp: ${format}. Please use a supported format: ${sharpSupported.join(', ')}`);
    }
  } else if (format === 'pdf') {
    await new Promise((resolve, reject) => {
      const doc = new PDFDocument();
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);
      doc.image(inputPath, { fit: [595, 842] });
      doc.end();
      stream.on('finish', () => {
        console.log(`Image to PDF conversion completed: ${outputPath}`);
        resolve();
      });
      stream.on('error', (err) => {
        console.error(`Image to PDF conversion failed: ${err.message}`);
        reject(new Error(`Image to PDF conversion failed: ${err.message}`));
      });
    });
  } else {
    throw new Error(`Unsupported image output format: ${format}`);
  }
}

async function convertPdf(inputPath, outputPath, format) {
  const inputExt = path.extname(inputPath).toLowerCase().slice(1);
  if (inputExt !== 'pdf') {
    throw new Error(`Unsupported input format for PDF conversion: ${inputExt}`);
  }
  if (['jpg', 'png', 'gif'].includes(format)) {
    try {
      const output = fromPath(inputPath, {
        density: 100,
        format: format,
        outputDir: path.dirname(outputPath),
        outputName: path.basename(outputPath, `.${format}`)
      });
      await output.bulk(-1);
      console.log(`PDF to ${format} conversion completed: ${outputPath}`);
    } catch (err) {
      console.error(`PDF to ${format} conversion failed: ${err.message}`);
      throw new Error(`PDF to ${format} conversion failed: ${err.message}`);
    }
  } else {
    throw new Error(`Unsupported PDF output format: ${format}`);
  }
}

async function convertMedia(inputPath, outputPath, format, inputExt) {
  const supportedAudioFormats = ['aac', 'aiff', 'flac', 'm4v', 'mmf', 'ogg', 'opus', 'wav', 'wma', '3g2', 'mp3'];
  const supportedVideoFormats = ['mp4', 'avi', 'mov', 'webm', 'mkv', 'flv', 'wmv', '3g2'];
  if (!supportedAudioFormats.includes(format) && !supportedVideoFormats.includes(format)) {
    throw new Error(`Unsupported media output format: ${format}`);
  }
  try {
    await new Promise((resolve, reject) => {
      const ffmpegInstance = ffmpeg(inputPath);
      const isAudioInput = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'opus', 'wma', 'aiff', 'mmf'].includes(inputExt);
      const isVideoOutput = supportedVideoFormats.includes(format);

      if (isVideoOutput && isAudioInput) {
        ffmpegInstance
          .input('color=c=black:s=320x240:r=25')
          .inputFormat('lavfi')
          .videoCodec('mpeg4')
          .audioCodec('aac')
          .outputOptions('-shortest', '-threads 1', '-preset ultrafast');
      } else {
        if (format === 'aac') {
          ffmpegInstance.audioCodec('aac');
        } else if (format === 'wma') {
          ffmpegInstance.audioCodec('wmav2');
        } else if (format === 'm4v' || format === '3g2') {
          ffmpegInstance
            .videoCodec('mpeg4')
            .audioCodec('aac');
        } else if (format === 'mmf') {
          ffmpegInstance.audioCodec('pcm_s16le');
        } else if (supportedVideoFormats.includes(format)) {
          ffmpegInstance
            .videoCodec('libx264')
            .audioCodec('aac');
        }
      }

      ffmpegInstance
        .outputOptions('-threads 1', '-preset ultrafast')
        .toFormat(format)
        .on('start', (cmd) => console.log(`FFmpeg command: ${cmd}`))
        .on('progress', (progress) => console.log(`Processing: ${progress.percent}% done`))
        .on('end', () => {
          console.log(`Media conversion completed: ${outputPath}`);
          resolve();
        })
        .on('error', (err, stdout, stderr) => {
          console.error(`Fluent-FFmpeg conversion error for ${format}: ${err.message}`, { stdout, stderr });
          reject(err);
        })
        .save(outputPath);
    });
  } catch (err) {
    console.warn(`Fluent-FFmpeg failed, falling back to direct FFmpeg: ${err.message}`);
    await new Promise((resolve, reject) => {
      const cmd = `ffmpeg -i "${inputPath}" -threads 1 -preset ultrafast "${outputPath}"`;
      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          console.error(`Direct FFmpeg conversion failed for ${format}: ${err.message}`, { stdout, stderr });
          return reject(new Error(`Media conversion failed: ${err.message}`));
        }
        console.log(`Direct FFmpeg conversion completed: ${outputPath}`);
        resolve();
      });
    });
  }
}

async function convertArchive(inputPath, outputPath, format) {
  if (format === 'zip' || format === '7z') {
    return new Promise((resolve, reject) => {
      sevenZip.add(outputPath, inputPath, { $raw: { '-t': format } })
        .on('end', () => {
          console.log(`Archive conversion completed: ${outputPath}`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`Archive conversion error: ${err.message}`);
          reject(new Error(`Archive conversion failed: ${err.message}`));
        });
    });
  } else {
    throw new Error(`Unsupported archive format: ${format}`);
  }
}

async function convertEbook(inputPath, outputPath, format) {
  return new Promise((resolve, reject) => {
    exec(`ebook-convert "${inputPath}" "${outputPath}"`, (err, stdout, stderr) => {
      if (err) {
        console.error(`Ebook conversion error: ${err.message}`, { stdout, stderr });
        return reject(new Error(`Ebook conversion failed: ${err.message}`));
      }
      console.log(`Ebook conversion completed: ${outputPath}`);
      resolve();
    });
  });
}

async function cleanupFiles(filePaths) {
  const maxRetries = 3;
  const retryDelay = 1000;
  const cleanupPromises = filePaths.map(async (filePath) => {
    let attempts = 0;
    while (attempts < maxRetries) {
      try {
        await fsPromises.access(filePath);
        await fsPromises.unlink(filePath);
        console.log(`Deleted file: ${filePath}`);
        return;
      } catch (err) {
        if (err.code === 'ENOENT') {
          console.log(`File not found for deletion: ${filePath}`);
          return;
        }
        if (err.code === 'EPERM') {
          attempts++;
          console.warn(`EPERM error on attempt ${attempts} for ${filePath}. Retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          if (attempts === maxRetries) {
            console.error(`Failed to delete file ${filePath} after ${maxRetries} attempts: ${err.message}`);
          }
        } else {
          console.error(`Error deleting file ${filePath}:`, err);
          break;
        }
      }
    }
  });
  await Promise.all(cleanupPromises);
}

// Start server with delay
(async () => {
  try {
    // Delay server start to ensure directories are ready
    setTimeout(() => {
      app.listen(port, '0.0.0.0', () => {
        console.log(`Server running on http://0.0.0.0:${port}`);
      });
    }, 5000);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
})();