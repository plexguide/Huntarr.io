import paramiko
import sys

def run_ssh_command(host, user, password, command):
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(host, username=user, password=password)
        stdin, stdout, stderr = client.exec_command(command)
        print(stdout.read().decode())
        print(stderr.read().decode(), file=sys.stderr)
        client.close()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    host = "10.0.0.10"
    user = "root"
    password = "JaslenE12@@"
    command = " ".join(sys.argv[1:])
    run_ssh_command(host, user, password, command)
