#!/usr/bin/env node

/**
 * Interactive Deprecate Script
 * 
 * This script allows you to deprecate specific versions or all versions
 * with interactive prompts and custom deprecation messages.
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

async function deprecateVersion(version: string, message: string): Promise<boolean> {
  try {
    logInfo(`Deprecating version ${version} with message: "${message}"`);
    
    // Try without OTP first
    try {
      const packageName = getPackageName();
      execSync(`npm deprecate ${packageName}@${version} "${message}"`, {
        cwd: projectRoot,
        encoding: 'utf8' as const,
        stdio: 'pipe' as const
      });
      logSuccess(`Version ${version} deprecated successfully`);
      return true;
    } catch (error: unknown) {
      const err = error as { status?: number; stderr?: Buffer; stdout?: Buffer };
      
      // Check if it's an OTP error
      if (err.stderr && err.stderr.toString().includes('EOTP')) {
        logInfo('🔐 2FA authentication required. Please provide your OTP code.');
        
        const otp = await promptForOTP();
        
        // Retry with OTP
        const packageName = getPackageName();
        execSync(`npm deprecate ${packageName}@${version} "${message}" --otp=${otp}`, {
          cwd: projectRoot,
          encoding: 'utf8' as const,
          stdio: 'pipe' as const
        });
        logSuccess(`Version ${version} deprecated successfully`);
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
      logError('Permission denied. You may not have permission to deprecate this version.');
    } else {
      logError(`Failed to deprecate version ${version}`);
      if (err.stderr) {
        logError(`Error: ${err.stderr.toString()}`);
      }
    }
    return false;
  }
}

async function main() {
  log('📢 Kalvora SDK Deprecate/Undeprecate Tool', colors.bright);
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
  
  // Get version to deprecate/undeprecate
  const versionInput = await prompt('Enter version to deprecate/undeprecate (or "all" for all versions): ');
  
  // Get deprecation message or undeprecate option
  const message = await prompt('Enter deprecation message (or "undeprecate" to remove deprecation): ');
  
  const isUndeprecate = message.toLowerCase().trim() === 'undeprecate';
  
  if (!isUndeprecate && !message.trim()) {
    logError('Deprecation message is required (or use "undeprecate")');
    process.exit(1);
  }
  
  if (versionInput.toLowerCase() === 'all') {
    if (isUndeprecate) {
      logWarning('⚠️  This will undeprecate ALL versions (remove deprecation messages)');
    } else {
      logWarning(`⚠️  This will deprecate ALL versions with message: "${message}"`);
    }
    
    const confirmed = await promptForConfirmation(`Are you sure you want to ${isUndeprecate ? 'undeprecate' : 'deprecate'} ALL versions?`);
    
    if (!confirmed) {
      logInfo('Operation cancelled by user');
      process.exit(0);
    }
    
    // Process all versions
    let successCount = 0;
    const actionMessage = isUndeprecate ? '' : message;
    
    for (const version of versions) {
      if (isUndeprecate) {
        logInfo(`Undeprecating version ${version}...`);
      } else {
        logInfo(`Deprecating version ${version}...`);
      }
      const success = await deprecateVersion(version, actionMessage);
      if (success) {
        successCount++;
      }
      // Small delay between operations
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    log('', colors.reset);
    if (isUndeprecate) {
      logSuccess(`Successfully undeprecated ${successCount}/${versions.length} versions`);
    } else {
      logSuccess(`Successfully deprecated ${successCount}/${versions.length} versions`);
    }
    
  } else {
    // Validate version exists
    if (!versions.includes(versionInput)) {
      logError(`Version ${versionInput} not found in published versions`);
      logInfo(`Available versions: ${versions.join(', ')}`);
      process.exit(1);
    }
    
    if (isUndeprecate) {
      logInfo(`This will undeprecate version ${versionInput} (remove deprecation message)`);
    } else {
      logInfo(`This will deprecate version ${versionInput} with message: "${message}"`);
    }
    
    const packageName = getPackageName();
    const confirmed = await promptForConfirmation(`Are you sure you want to ${isUndeprecate ? 'undeprecate' : 'deprecate'} ${packageName}@${versionInput}?`);
    
    if (!confirmed) {
      logInfo('Operation cancelled by user');
      process.exit(0);
    }
    
    const actionMessage = isUndeprecate ? '' : message;
    const success = await deprecateVersion(versionInput, actionMessage);
    
    if (success) {
      log('', colors.reset);
      if (isUndeprecate) {
        logSuccess('Undeprecation completed successfully!');
      } else {
        logSuccess('Deprecation completed successfully!');
      }
    } else {
      log('', colors.reset);
      if (isUndeprecate) {
        logError('Undeprecation failed!');
      } else {
        logError('Deprecation failed!');
      }
      process.exit(1);
    }
  }
  
  log('', colors.reset);
  if (isUndeprecate) {
    logInfo('💡 Tip: Users will no longer see deprecation warnings for these versions');
    logInfo('💡 Tip: The versions are now available for normal installation');
  } else {
    logInfo('💡 Tip: Users will see deprecation warnings when installing these versions');
    logInfo('💡 Tip: Consider providing migration instructions in your deprecation message');
  }
}

main().catch(error => {
  logError('Unexpected error occurred');
  logError(error.message);
  process.exit(1);
});
