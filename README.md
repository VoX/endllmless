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
