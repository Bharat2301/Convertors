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

# Create a user for LibreOffice to avoid permission issues
RUN useradd -m -u 1000 -G sudo officeuser \
    && mkdir -p /home/officeuser/.config/libreoffice/4/user \
    && mkdir -p /tmp/officeuser-runtime \
    && chown -R officeuser:officeuser /home/officeuser \
    && chown -R officeuser:officeuser /tmp/officeuser-runtime \
    && chmod -R 777 /tmp/officeuser-runtime

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
ENV XDG_RUNTIME_DIR=/tmp/officeuser-runtime

# Create necessary directories with correct permissions
RUN mkdir -p /app/Uploads /app/converted /app/tmp \
    && chown -R officeuser:officeuser /app \
    && chmod -R 777 /app/Uploads /app/converted /app/tmp

USER officeuser

EXPOSE $PORT