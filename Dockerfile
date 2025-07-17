FROM node:18-bullseye

# Install system dependencies with clean up
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libreoffice \
    libreoffice-writer \
    libreoffice-impress \
    libreoffice-calc \
    libreoffice-java-common \
    default-jre \
    ghostscript \
    calibre \
    unoconv \
    p7zip-full \
    pdftohtml \
    poppler-utils \
    pandoc \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create a user for LibreOffice, checking for existing user
RUN if id -u officeuser >/dev/null 2>&1; then \
        echo "User officeuser already exists, skipping creation"; \
    else \
        useradd -m -u 1001 -s /bin/bash officeuser || { echo "Failed to create officeuser with UID 1001, trying next available UID"; useradd -m -s /bin/bash officeuser; }; \
    fi \
    && mkdir -p /home/officeuser/.config/libreoffice/4/user \
    && mkdir -p /app/tmp/officeuser-runtime \
    && chown -R officeuser:officeuser /home/officeuser \
    && chown -R officeuser:officeuser /app/tmp/officeuser-runtime \
    && chmod -R 777 /app/tmp/officeuser-runtime

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Set environment variables
ENV PORT=5001
ENV LIBREOFFICE_PATH=/usr/bin/unoconv
ENV FRONTEND_URL=https://convertors-frontend.onrender.com
ENV NODE_ENV=production
ENV HOME=/home/officeuser
ENV USER=officeuser
ENV XDG_RUNTIME_DIR=/app/tmp/officeuser-runtime

# Create necessary directories with correct permissions
RUN mkdir -p /app/Uploads /app/converted /app/tmp \
    && chown -R officeuser:officeuser /app \
    && chmod -R 777 /app/Uploads /app/converted /app/tmp

USER officeuser

EXPOSE $PORT
CMD ["node", "server.js"]