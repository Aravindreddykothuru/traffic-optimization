import subprocess
import os
import sys
import time
import signal

def main():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.join(root_dir, "backend")
    frontend_dir = os.path.join(root_dir, "frontend")

    print("\033[94m======================================\033[0m", flush=True)
    print("\033[94m  Traffic Signal Optimization App     \033[0m", flush=True)
    print("\033[94m======================================\033[0m\n", flush=True)

    # Start backend
    print("Starting \033[92mBackend (Flask)\033[0m on http://localhost:5000...", flush=True)
    backend_process = subprocess.Popen(
        [sys.executable, "app.py"],
        cwd=backend_dir,
        shell=True if os.name == 'nt' else False
    )

    # Give backend a moment to start
    time.sleep(2)

    # Start frontend
    print("Starting \033[96mFrontend (Vite)\033[0m on http://localhost:5173...", flush=True)
    frontend_process = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=frontend_dir,
        shell=True if os.name == 'nt' else False
    )

    print("\n\033[1mProcesses Spawned Successfully!\033[0m", flush=True)
    print(f"   \033[92mBackend\033[0m  : http://localhost:5000", flush=True)
    print(f"   \033[96mFrontend\033[0m : http://localhost:5173", flush=True)
    print("\nPress \033[91mCtrl+C\033[0m to stop both servers.\n", flush=True)

    try:
        while True:
            # We could optionally print output from processes here, 
            # but it might get messy. Let's just monitor life.
            if backend_process.poll() is not None:
                print("\033[91mBackend process stopped unexpectedly.\033[0m")
                break
            if frontend_process.poll() is not None:
                print("\033[91mFrontend process stopped unexpectedly.\033[0m")
                break
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\033[93mShutting down servers...\033[0m")
    finally:
        if os.name == 'nt':
            subprocess.run(['taskkill', '/F', '/T', '/PID', str(backend_process.pid)], capture_output=True)
            subprocess.run(['taskkill', '/F', '/T', '/PID', str(frontend_process.pid)], capture_output=True)
        else:
            os.killpg(os.getpgid(backend_process.pid), signal.SIGTERM)
            os.killpg(os.getpgid(frontend_process.pid), signal.SIGTERM)
        print("\033[92mDone.\033[0m")

if __name__ == "__main__":
    main()
