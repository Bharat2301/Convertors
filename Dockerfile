FROM node:18-bullseye

# Install system dependencies including Python and pip
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
    python3 \
    python3-pip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install pdf2docx and its dependencies
RUN pip3 install pdf2docx PyMuPDF python-docx --break-system-packages

# Create a user for LibreOffice, checking for existing user
RUN if id -u officeuser >/dev/null 2>&1; then \
        echo "User officeuser already exists, skipping creation"; \
    else \
        useradd -m -u 1001 -s /bin/bash officeuser || { echo "Failed to create officeuser with UID 1001, trying next available UID"; useradd -m -s /bin/bash officeuser; }; \
    fi \
    && mkdir -p /home/officeuser/.config/libreoffice/4/user \
    && mkdir -p /app/tmp/officeuser-runtime \
    && mkdir -p /app/Uploads /app/converted /app/tmp \
    && chown -R officeuser:officeuser /home/officeuser /app \
    && chmod -R 777 /app/Uploads /app/converted /app/tmp /app/tmp/officeuser-runtime

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

USER officeuser

EXPOSE $PORT
CMD ["node", "server.js"]