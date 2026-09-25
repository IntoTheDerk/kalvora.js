#!/usr/bin/env node

/**
 * Interactive Unpublish Script
 * 
 * This script allows you to unpublish specific versions or all versions
 * with interactive prompts and safety confirmations.
 * Package name is automatically detected from package.json.
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { createInterface } from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message: string, color: string = colors.reset): void {
  const timestamp = new Date().toISOString().substr(11, 8);
  console.log(`${color}[${timestamp}] ${message}${colors.reset}`);
}

function logSuccess(message: string): void {
  log(`✅ ${message}`, colors.green);
}

function logError(message: string): void {
  log(`❌ ${message}`, colors.red);
}

function logWarning(message: string): void {
  log(`⚠️  ${message}`, colors.yellow);
}

function logInfo(message: string): void {
  log(`ℹ️  ${message}`, colors.blue);
}

function getPackageName(): string {
  try {
    const packageJsonPath = join(projectRoot, 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return packageJson.name;
  } catch {
    logError('Failed to read package name from package.json');
    process.exit(1);
  }
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptForConfirmation(message: string): Promise<boolean> {
  const answer = await prompt(`${message} (y/N): `);
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

async function promptForOTP(): Promise<string> {
  return prompt('🔐 Enter your 6-digit OTP code from your authenticator app: ');
}

function getPublishedVersions(): string[] {
  try {
    const packageName = getPackageName();
    const result = execSync(`npm view ${packageName} versions --json`, {
      cwd: projectRoot,
      encoding: 'utf8' as const
    });
    const versions = JSON.parse(result);
    return Array.isArray(versions) ? versions : [];
  } catch {
    logError('Could not fetch published versions');
    return [];
  }
}

async function unpublishVersion(version: string): Promise<boolean> {
  try {
    logInfo(`Attempting to unpublish version ${version}...`);
    
    // Try without OTP first
    try {
      const packageName = getPackageName();
      execSync(`npm unpublish ${packageName}@${version}`, {
        cwd: projectRoot,
        encoding: 'utf8' as const,
        stdio: 'pipe' as const
      });
      logSuccess(`Version ${version} unpublished successfully`);
      return true;
    } catch (error: unknown) {
      const err = error as { status?: number; stderr?: Buffer; stdout?: Buffer };
      
      // Check if it's an OTP error
      if (err.stderr && err.stderr.toString().includes('EOTP')) {
        logInfo('🔐 2FA authentication required. Please provide your OTP code.');
        
        const otp = await promptForOTP();
        
        // Retry with OTP
        const packageName = getPackageName();
        execSync(`npm unpublish ${packageName}@${version} --otp=${otp}`, {
          cwd: projectRoot,
          encoding: 'utf8' as const,
          stdio: 'pipe' as const
        });
        logSuccess(`Version ${version} unpublished successfully`);
        return true;
      } else {
        throw error; // Re-throw if it's not an OTP error
      }
    }
  } catch (error: unknown) {
    const err = error as { status?: number; stderr?: Buffer; stdout?: Buffer };
    
    if (err.status === 404) {
      logError(`Version ${version} not found on npm registry`);
    } else if (err.status === 403) {
      logError('Permission denied. You may not have permission to unpublish this version.');
    } else if (err.status === 400) {
      logError('Cannot unpublish this version. It may be too old or have dependencies.');
    } else {
      logError(`Failed to unpublish version ${version}`);
      if (err.stderr) {
        logError(`Error: ${err.stderr.toString()}`);
      }
    }
    return false;
  }
}

async function main() {
  log('🗑️  Kalvora SDK Unpublish Tool', colors.bright);
  log('', colors.reset);
  
  // Get published versions
  const versions = getPublishedVersions();
  
  if (versions.length === 0) {
    logError('No published versions found or unable to fetch versions');
    process.exit(1);
  }
  
  logInfo(`Found ${versions.length} published versions:`);
  versions.forEach((version, index) => {
    log(`  ${index + 1}. ${version}`, colors.reset);
  });
  log('', colors.reset);
  
  // Get version to unpublish
  const versionInput = await prompt('Enter version to unpublish (or "all" for all versions): ');
  
  if (versionInput.toLowerCase() === 'all') {
    const packageName = getPackageName();
    logWarning(`⚠️  WARNING: This will unpublish ALL versions of ${packageName}!`);
    logWarning('This action cannot be undone and will break all applications using this package.');
    
    const confirmed = await promptForConfirmation('Are you absolutely sure you want to unpublish ALL versions?');
    
    if (!confirmed) {
      logInfo('Operation cancelled by user');
      process.exit(0);
    }
    
    // Unpublish all versions (newest first to avoid dependency issues)
    const sortedVersions = [...versions].reverse();
    let successCount = 0;
    
    for (const version of sortedVersions) {
      logInfo(`Unpublishing version ${version}...`);
      const success = await unpublishVersion(version);
      if (success) {
        successCount++;
      }
      // Small delay between unpublishes
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    log('', colors.reset);
    logSuccess(`Successfully unpublished ${successCount}/${versions.length} versions`);
    
  } else {
    // Validate version exists
    if (!versions.includes(versionInput)) {
      logError(`Version ${versionInput} not found in published versions`);
      logInfo(`Available versions: ${versions.join(', ')}`);
      process.exit(1);
    }
    
    logWarning(`⚠️  WARNING: This will permanently remove version ${versionInput} from npm!`);
    logWarning('This action cannot be undone and may break applications using this version.');
    
    const packageName = getPackageName();
    const confirmed = await promptForConfirmation(`Are you sure you want to unpublish ${packageName}@${versionInput}?`);
    
    if (!confirmed) {
      logInfo('Operation cancelled by user');
      process.exit(0);
    }
    
    const success = await unpublishVersion(versionInput);
    
    if (success) {
      log('', colors.reset);
      logSuccess('Unpublish completed successfully!');
    } else {
      log('', colors.reset);
      logError('Unpublish failed!');
      process.exit(1);
    }
  }
}

main().catch(error => {
  logError('Unexpected error occurred');
  logError(error.message);
  process.exit(1);
});
