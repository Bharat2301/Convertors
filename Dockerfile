# Use Node.js 18 based on Debian Bullseye as the base image
FROM node:18-bullseye

# Install system dependencies required for FFmpeg, LibreOffice, Calibre, and Python packages
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
    python3.9 \
    python3.9-dev \
    python3-pip \
    libmupdf-dev \
    libfreetype6-dev \
    libjpeg-dev \
    zlib1g-dev \
    libpng-dev \
    libxml2-dev \
    libxslt1-dev \
    libtiff-dev \
    libopenjp2-7-dev \
    liblua5.3-0 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.9 1 \
    && pip3 install --no-cache-dir --upgrade pip setuptools wheel

# Install Python packages with specific versions for compatibility
RUN pip3 install --no-cache-dir \
    pdf2docx==0.5.8 \
    PyMuPDF==1.24.10 \
    python-docx==1.1.2 \
    Pillow==10.4.0 \
    numpy==1.26.4 \
    opencv-python==4.10.0.84

# Create a non-root user for LibreOffice and set up directories
RUN useradd -m -u 1001 -s /bin/bash officeuser || echo "User officeuser creation failed, using existing user" \
    && mkdir -p /home/officeuser/.config/libreoffice/4/user \
    && mkdir -p /app/tmp/officeuser-runtime \
    && mkdir -p /app/Uploads /app/converted /app/tmp \
    && chown -R officeuser:officeuser /home/officeuser /app \
    && chmod -R 777 /app/Uploads /app/converted /app/tmp /app/tmp/officeuser-runtime

# Set working directory
WORKDIR /app

# Copy package.json and install Node.js dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Set environment variables for production
ENV PORT=5001
ENV LIBREOFFICE_PATH=/usr/bin/unoconv
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