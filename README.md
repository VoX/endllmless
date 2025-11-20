# ENDLLMLESS

<https://endless.bitvox.me>

## Start Development

- `export OPENAI_API_KEY=<key>`
- `npm i && npm run dev`

## Deployment (Docker)

### 1. Install Docker & Git on Amazon Linux 2023

```bash
sudo yum update -y
sudo yum install -y docker git
sudo service docker start
sudo usermod -a -G docker ec2-user
# Log out and back in, or run:
newgrp docker
```

### 2. Configure SSH for Tunneling (Optional)

Required if you are using the Jellyfin proxy feature.

```bash
echo "GatewayPorts yes" | sudo tee -a /etc/ssh/sshd_config
sudo service sshd restart
```

### 3. Clone the Repository

```bash
git clone https://github.com/VoX/endllmless.git
cd endllmless
```

### 4. Build the Container

```bash
docker build -t endllmless .
```

### 5. Run the Container

Replace `<your_openai_key>` with your actual API key.

```bash
docker run -d \
  --restart on-failure \
  --add-host=host.docker.internal:host-gateway \
  -p 80:80 -p 443:443 \
  -e OPENAI_API_KEY=<your_openai_key> \
  -e JELLY_PATH=<your_secret_path_prefix> \
  endllmless
```

**Note:**

1. The `--add-host` flag is required for Caddy to access services running on the
   host machine.
2. `JELLY_PATH` should be the secret path segment without leading/trailing
   slashes. on the host machine (like the service on port 8097).

## Updating Production Deployment

To update the running application with the latest code:

1. **Pull the latest changes:**
   ```bash
   git pull
   ```

2. **Rebuild the Docker image:**
   ```bash
   docker build -t endllmless .
   ```

3. **Stop and remove the old container:**
   ```bash
   # Stop the running container (replace <container_id> with actual ID from `docker ps`)
   docker stop $(docker ps -q --filter ancestor=endllmless)

   # Remove the stopped container
   docker rm $(docker ps -aq --filter ancestor=endllmless)
   ```

4. **Start the new container:** (Run the same command as in Step 5 above)
   ```bash
   docker run -d \
     --restart on-failure \
     --add-host=host.docker.internal:host-gateway \
     -p 80:80 -p 443:443 \
     -e OPENAI_API_KEY=<your_openai_key> \
     -e JELLY_PATH=<your_secret_path_prefix> \
     endllmless
   ```
