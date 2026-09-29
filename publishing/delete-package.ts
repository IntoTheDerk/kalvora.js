#!/usr/bin/env node

/**
 * DESTRUCTIVE PACKAGE DELETION SCRIPT
 * 
 * ⚠️  WARNING: This script will PERMANENTLY DELETE the entire package from npm!
 * ⚠️  This action CANNOT be undone and will break all applications using this package!
 * ⚠️  Only use this if you are absolutely certain you want to delete everything!
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
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
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

function logDanger(message: string): void {
  log(`🚨 ${message}`, colors.red);
}

function logBold(message: string): void {
  log(`${colors.bright}${message}${colors.reset}`, colors.bright);
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

function getPackageName(): string {
  try {
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    return packageJson.name;
  } catch {
    logError('Could not read package.json');
    throw new Error('Could not read package.json');
  }
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

function showDestructiveWarning(packageName: string, versions: string[]): void {
  console.log('');
  logBold('🚨🚨🚨 DESTRUCTIVE PACKAGE DELETION 🚨🚨🚨');
  console.log('');
  logDanger('⚠️  WARNING: This script will PERMANENTLY DELETE the entire package!');
  logDanger('⚠️  This action CANNOT be undone!');
  logDanger('⚠️  All versions will be permanently removed from npm!');
  logDanger('⚠️  All applications using this package will break!');
  console.log('');
  logBold(`📦 Package Name: ${packageName}`);
  logBold(`📊 Total Versions: ${versions.length}`);
  console.log('');
  logBold('📋 Versions that will be DELETED:');
  versions.forEach((version, index) => {
    log(`  ${index + 1}. ${version}`, colors.red);
  });
  console.log('');
  logDanger('🚨 This will affect ALL users of this package!');
  logDanger('🚨 Breaking changes will occur immediately!');
  logDanger('🚨 No recovery is possible after deletion!');
  console.log('');
}

async function deletePackage(packageName: string): Promise<boolean> {
  try {
    logInfo(`Attempting to delete entire package: ${packageName}...`);
    
    // Try without OTP first
    try {
      execSync(`npm unpublish ${packageName} --force`, {
        cwd: projectRoot,
        encoding: 'utf8' as const,
        stdio: 'pipe' as const
      });
      logSuccess(`Package ${packageName} deleted successfully`);
      return true;
    } catch (error: unknown) {
      const err = error as { status?: number; stderr?: Buffer; stdout?: Buffer };
      
      // Check if it's an OTP error
      if (err.stderr && err.stderr.toString().includes('EOTP')) {
        logInfo('🔐 2FA authentication required for package deletion. Please provide your OTP code.');
        
        const otp = await promptForOTP();
        
        // Retry with OTP
        execSync(`npm unpublish ${packageName} --force --otp=${otp}`, {
          cwd: projectRoot,
          encoding: 'utf8' as const,
          stdio: 'pipe' as const
        });
        logSuccess(`Package ${packageName} deleted successfully`);
        return true;
      } else {
        throw error; // Re-throw if it's not an OTP error
      }
    }
  } catch (error: unknown) {
    const err = error as { status?: number; stderr?: Buffer; stdout?: Buffer };
    
    if (err.status === 404) {
      logError(`Package ${packageName} not found on npm registry`);
    } else if (err.status === 403) {
      logError('Permission denied. You may not have permission to delete this package.');
    } else if (err.status === 400) {
      logError('Cannot delete this package. It may be too old or have dependencies.');
    } else {
      logError(`Failed to delete package ${packageName}`);
      if (err.stderr) {
        logError(`Error: ${err.stderr.toString()}`);
      }
    }
    return false;
  }
}

async function main() {
  // Check for --fast flag
  const args = process.argv.slice(2);
  const isFast = args.includes('--fast');
  const countdownSeconds = isFast ? 10 : 120;
  
  logBold('🗑️  PACKAGE DELETION TOOL');
  logBold('⚠️  DESTRUCTIVE OPERATION ⚠️');
  console.log('');
  
  if (isFast) {
    logWarning('⚡ FAST MODE: 10-second countdown enabled');
  } else {
    logInfo('🐌 NORMAL MODE: 120-second countdown (use --fast for 10 seconds)');
  }
  console.log('');
  
  // Get package information
  const packageName = getPackageName();
  const versions = getPublishedVersions();
  
  if (versions.length === 0) {
    logError('No published versions found or unable to fetch versions');
    logInfo('Package may already be deleted or not exist');
    process.exit(1);
  }
  
  // Show destructive warning
  showDestructiveWarning(packageName, versions);
  
  // FIRST CONFIRMATION
  logBold('🔴 FIRST CONFIRMATION REQUIRED 🔴');
  const firstConfirm = await promptForConfirmation(
    `Are you absolutely certain you want to PERMANENTLY DELETE the entire package "${packageName}"?`
  );
  
  if (!firstConfirm) {
    logInfo('Operation cancelled by user');
    process.exit(0);
  }
  
  console.log('');
  logWarning('⚠️  You have confirmed the first step...');
  logWarning('⚠️  This is your LAST CHANCE to cancel!');
  console.log('');
  
  // SECOND CONFIRMATION
  logBold('🔴 SECOND CONFIRMATION REQUIRED 🔴');
  const secondConfirm = await prompt(
    `FINAL WARNING: Type "yes" to PERMANENTLY DELETE "${packageName}" and ALL ${versions.length} versions. This cannot be undone!\nType exactly "yes" (without quotes): `
  );
  
  if (secondConfirm.toLowerCase() !== 'yes') {
    logInfo('Operation cancelled by user');
    process.exit(0);
  }
  
  console.log('');
  logDanger('🚨 BOTH CONFIRMATIONS RECEIVED! 🚨');
  logDanger('🚨 PROCEEDING WITH PACKAGE DELETION! 🚨');
  console.log('');
  logInfo('💡 You can press Ctrl+C (or Cmd+C on Mac) at any time to cancel');
  console.log('');
  
  // Set up signal handlers for graceful cancellation
  let cancelled = false;
  const signalHandler = () => {
    cancelled = true;
    console.log('');
    logInfo('🛑 Deletion cancelled by user (Ctrl+C)');
    logInfo('🛑 Package deletion aborted');
    process.exit(0);
  };
  
  process.on('SIGINT', signalHandler);
  process.on('SIGTERM', signalHandler);
  
  // Final countdown
  for (let i = countdownSeconds; i > 0; i--) {
    if (cancelled) break;
    logDanger(`🚨 DELETION IN ${i} SECONDS... 🚨`);
    
    // Show Ctrl+C reminder every 5 seconds (or every 2 seconds in fast mode)
    const reminderInterval = isFast ? 2 : 5;
    if (i % reminderInterval === 0 && i !== countdownSeconds) {
      logInfo('💡 Press Ctrl+C (or Cmd+C on Mac) to cancel');
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Remove signal handlers
  process.removeListener('SIGINT', signalHandler);
  process.removeListener('SIGTERM', signalHandler);
  
  console.log('');
  logDanger('🚨 DELETING PACKAGE NOW! 🚨');
  console.log('');
  
  const success = await deletePackage(packageName);
  
  if (success) {
    console.log('');
    logSuccess('🎉 PACKAGE DELETION COMPLETED!');
    logSuccess('🎉 All versions have been permanently removed from npm');
    console.log('');
    logInfo('💡 The package name is now available for reuse after 24 hours');
    logInfo('💡 All applications using this package will now fail to install');
    logInfo('💡 Consider notifying users about the package removal');
  } else {
    console.log('');
    logError('❌ PACKAGE DELETION FAILED!');
    logError('❌ The package may still exist on npm');
    process.exit(1);
  }
}

main().catch(error => {
  logError('Unexpected error occurred');
  logError(error.message);
  process.exit(1);
});
