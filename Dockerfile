FROM node:18-bullseye

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libreoffice \
    ghostscript \
    calibre \
    unoconv \
    p7zip-full \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Set environment variables
ENV PORT=5001
ENV LIBREOFFICE_PATH=/usr/bin/unoconv
ENV FRONTEND_URL=https://convertors-frontend.onrender.com
ENV NODE_ENV=production

EXPOSE $PORT
CMD ["node", "server.js"]