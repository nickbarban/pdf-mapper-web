# Deploy to AWS EC2 (free tier)

## 1. Create an EC2 instance

- **AMI**: Amazon Linux 2023 or Ubuntu 22.04
- **Instance type**: `t2.micro` or `t3.micro` (free tier eligible)
- **Storage**: 8–30 GB
- **Security group**: allow SSH (22) only from your IP or a small trusted CIDR (avoid 0.0.0.0/0); allow HTTP (80) and custom 5171, 5172 if you want direct access, or put behind a reverse proxy later. Consider using AWS Session Manager or a bastion host instead of wide-open SSH.

## 2. Install Docker on EC2

SSH into the instance, then:

**Amazon Linux 2023:**
```bash
sudo yum update -y
sudo yum install -y docker
sudo systemctl enable docker
sudo systemctl start docker
sudo usermod -aG docker ec2-user
# Log out and back in so docker runs without sudo
```

**Ubuntu:**
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2
sudo systemctl enable docker && sudo systemctl start docker
sudo usermod -aG docker ubuntu
# Log out and back in
```

Install Docker Compose v2 if not included (e.g. Amazon Linux):
```bash
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

## 3. Prepare the app directory on EC2

```bash
mkdir -p /home/ec2-user/pdf-mapper-web
mkdir -p /home/ec2-user/pdf-mapper-web/data
# Optional: add a test project and PDF
# mkdir -p /home/ec2-user/pdf-mapper-web/data/projects/project1
```

## 4. GitHub repository secrets

In the repo: **Settings → Secrets and variables → Actions**, add:

| Secret            | Description |
|-------------------|-------------|
| `EC2_HOST`        | Public DNS or IP (e.g. `ec2-3-xx-xx-xx.compute.amazonaws.com`) |
| `EC2_USER`        | `ec2-user` (Amazon Linux) or `ubuntu` (Ubuntu). Optional; defaults to `ec2-user`. |
| `DEPLOY_PATH`     | Optional. Full path on EC2 (e.g. `/home/ubuntu/pdf-mapper-web` for Ubuntu). Defaults to `/home/ec2-user/pdf-mapper-web`. |
| `SSH_PRIVATE_KEY` | Full contents of the `.pem` private key for this instance (the key you use with `ssh -i key.pem ec2-user@host`) |

Paste the **entire** private key (including `-----BEGIN ... KEY-----` and `-----END ... KEY-----`).

## 5. Deploy

**From GitHub (CI/CD):**
- Push (or merge) to the `main` branch → workflow runs and deploys.
- Or run manually: **Actions → Deploy to EC2 → Run workflow**.

**From your machine (same steps as the workflow):**
```bash
export EC2_HOST=ec2-xx-xx-xx.compute.amazonaws.com
export SSH_KEY_PATH=~/.ssh/your-key.pem
./scripts/deploy-ec2.sh
```
The script uses **rsync** to copy the repo to EC2 and **SSH** to run `docker compose -f docker-compose.prod.yml up -d` there. No AWS CLI is required (deploy is over SSH).

## 6. Access the app

**Option A – Production (single port, recommended)**  
Use the production compose so the backend serves the frontend:

- In the workflow or on EC2, run: `docker compose -f docker-compose.prod.yml up -d`
- Open: **http://&lt;EC2_PUBLIC_IP&gt;:8080** (UI and API)

**Option B – Dev-style (two ports)**  
Default workflow uses `docker compose up -d` (two services):

- Frontend: `http://<EC2_PUBLIC_IP>:5172`
- Backend API: `http://<EC2_PUBLIC_IP>:5171`

Ensure the security group allows the ports you use (8080 for prod, or 5171 and 5172 for dev-style), or put a reverse proxy (e.g. nginx) on port 80.

## Notes

- The workflow **does not** overwrite the `data/` folder on EC2 (it is excluded), so uploaded PDFs and mappings persist.
- First run builds images on EC2; later runs reuse layers when possible.
- To use a different branch, change the `branches: [main]` in `.github/workflows/deploy.yml`.
