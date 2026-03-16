import { execFile } from "node:child_process";
import { platform } from "node:os";

export interface IdleDetector {
	getIdleTimeMs(): Promise<number>;
	isIdle(thresholdMs: number): Promise<boolean>;
}

export function createIdleDetector(): IdleDetector {
	const os = platform();

	return {
		async getIdleTimeMs(): Promise<number> {
			switch (os) {
				case "darwin":
					return getDarwinIdleTime();
				case "linux":
					return getLinuxIdleTime();
				case "win32":
					return getWindowsIdleTime();
				default:
					return 0;
			}
		},

		async isIdle(thresholdMs: number): Promise<boolean> {
			const idle = await this.getIdleTimeMs();
			return idle >= thresholdMs;
		},
	};
}

function getDarwinIdleTime(): Promise<number> {
	return new Promise((resolve) => {
		execFile("ioreg", ["-c", "IOHIDSystem", "-d", "4"], { timeout: 5000 }, (err, stdout) => {
			if (err) {
				resolve(0);
				return;
			}
			const match = stdout.match(/"HIDIdleTime"\s*=\s*(\d+)/);
			if (match) {
				// HIDIdleTime is in nanoseconds
				resolve(Number(match[1]) / 1_000_000);
			} else {
				resolve(0);
			}
		});
	});
}

function getLinuxIdleTime(): Promise<number> {
	return new Promise((resolve) => {
		execFile("xprintidle", { timeout: 5000 }, (err, stdout) => {
			if (err) {
				resolve(0);
				return;
			}
			resolve(Number(stdout.trim()));
		});
	});
}

function getWindowsIdleTime(): Promise<number> {
	return new Promise((resolve) => {
		// Use PowerShell to query GetLastInputInfo
		const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class IdleTime {
    [DllImport("user32.dll")]
    static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
    [StructLayout(LayoutKind.Sequential)]
    struct LASTINPUTINFO {
        public uint cbSize;
        public uint dwTime;
    }
    public static int Get() {
        var info = new LASTINPUTINFO();
        info.cbSize = (uint)Marshal.SizeOf(info);
        GetLastInputInfo(ref info);
        return Environment.TickCount - (int)info.dwTime;
    }
}
'@
[IdleTime]::Get()
`;
		execFile(
			"powershell",
			["-NoProfile", "-Command", script],
			{ timeout: 10000 },
			(err, stdout) => {
				if (err) {
					resolve(0);
					return;
				}
				resolve(Number(stdout.trim()));
			},
		);
	});
}
