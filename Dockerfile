FROM node:18
RUN apt-get update && apt-get install -y ffmpeg libreoffice imagemagick calibre
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5001
CMD ["npm", "run", "dev"]