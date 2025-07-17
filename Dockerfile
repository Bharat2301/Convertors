FROM node:18-bullseye

# Install system dependencies required for FFmpeg, Ghostscript, Calibre, and LibreOffice
RUN apt-get update && apt-get install -y \
    ffmpeg \
    ghostscript \
    calibre \
    libreoffice \
    p7zip-full \
    pdftohtml \
    poppler-utils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create directories and set permissions as root
RUN mkdir -p /app /app/Uploads /app/converted /app/tmp /app/tmp/officeuser-runtime \
    && chown -R node:node /app /app/Uploads /app/converted /app/tmp /app/tmp/officeuser-runtime \
    && chmod -R 775 /app /app/Uploads /app/converted /app/tmp /app/tmp/officeuser-runtime \
    && ls -ld /app /app/Uploads /app/converted /app/tmp /app/tmp/officeuser-runtime

# Use the existing 'node' user (UID 1000) instead of creating a new one
# Set working directory
WORKDIR /app

# Copy package.json and install Node.js dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Set environment variables for production
ENV PORT=5001
ENV FRONTEND_URL=https://convertors-frontend.onrender.com
ENV NODE_ENV=production
ENV HOME=/home/node
ENV USER=node
ENV XDG_RUNTIME_DIR=/app/tmp/officeuser-runtime
ENV CONVERSION_TIMEOUT=120000

# Switch to non-root user
USER node

# Expose the application port
EXPOSE $PORT

# Start the application
CMD ["node", "server.js"]