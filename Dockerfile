# Use Node.js 18 based on Debian Bullseye as the base image
FROM node:18-bullseye

# Install system dependencies required for FFmpeg, Ghostscript, and Calibre
RUN apt-get update && apt-get install -y \
    ffmpeg \
    ghostscript \
    calibre \
    p7zip-full \
    pdftohtml \
    poppler-utils \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create directories and set permissions as root
RUN mkdir -p /app/Uploads /app/converted /app/tmp /app/tmp/officeuser-runtime \
    && chown -R 1001:1001 /app /app/Uploads /app/converted /app/tmp /app/tmp/officeuser-runtime \
    && chmod -R 777 /app /app/Uploads /app/converted /app/tmp /app/tmp/officeuser-runtime

# Create a non-root user
RUN useradd -m -u 1001 -s /bin/bash officeuser || echo "User officeuser creation failed, using existing user" \
    && mkdir -p /home/officeuser \
    && chown -R officeuser:officeuser /home/officeuser \
    && chmod -R 777 /home/officeuser

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
ENV HOME=/home/officeuser
ENV USER=officeuser
ENV XDG_RUNTIME_DIR=/app/tmp/officeuser-runtime
ENV CONVERSION_TIMEOUT=120000

# Switch to non-root user
USER officeuser

# Expose the application port
EXPOSE $PORT

# Start the application
CMD ["node", "server.js"]