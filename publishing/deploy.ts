#!/usr/bin/env node

/**
 * NPM Registry Deployment Script
 * 
 * This script handles the complete deployment process to the public npm registry
 * Package name is automatically detected from package.json
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
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

function logStep(step: number, message: string): void {
  log(`📋 Step ${step}: ${message}`, colors.cyan);
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


function exec(command: string, options: { cwd?: string; stdio?: 'inherit' | 'pipe' | 'ignore'; encoding?: 'utf8' | 'ascii' | 'base64' | 'hex' | 'latin1' | 'ucs2' | 'utf16le' } = {}): void {
  try {
    execSync(command, { 
      stdio: 'inherit', 
      cwd: projectRoot,
      ...options 
    });
  } catch (error: unknown) {
    logError(`Command failed: ${command}`);
    const err = error as { status?: number; stderr?: Buffer; stdout?: Buffer };
    if (err.status) {
      logError(`Exit code: ${err.status}`);
    }
    if (err.stderr) {
      logError(`Error output: ${err.stderr.toString()}`);
    }
    if (err.stdout) {
      logError(`Standard output: ${err.stdout.toString()}`);
    }
    throw error;
  }
}

function checkPrerequisites() {
  logStep(1, 'Checking prerequisites');
  
  // Check if we're logged into npm
  try {
    execSync('npm whoami', { 
      cwd: projectRoot, 
      encoding: 'utf8' as const,
      stdio: 'pipe' as const
    });
    logSuccess('Logged into npm');
  } catch {
    logError('Not logged into npm');
    logInfo('Run: npm login');
    process.exit(1);
  }
  
  // Show current branch
  try {
    const branch = execSync('git branch --show-current', { 
      cwd: projectRoot, 
      encoding: 'utf8' as const
    }).trim();
    logInfo(`Current branch: ${branch}`);
  } catch {
    logWarning('Could not determine current branch');
  }
  
  logSuccess('Prerequisites check completed');
}

function getPackageName(): string {
  try {
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    return packageJson.name;
  } catch (error) {
    logError('Could not read package.json');
    throw error;
  }
}

function getCurrentVersion() {
  try {
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    return packageJson.version;
  } catch (error) {
    logError('Could not read package.json');
    throw error;
  }
}

function getLatestPublishedVersion(): string {
  try {
    const packageName = getPackageName();
    const result = execSync(`npm view ${packageName} versions --json`, {
      cwd: projectRoot,
      encoding: 'utf8' as const
    });
    const versions = JSON.parse(result);
    if (Array.isArray(versions) && versions.length > 0) {
      // Sort versions and get the latest
      const sortedVersions = versions.sort((a: string, b: string) => {
        // Simple version comparison - for more complex cases, use semver library
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
      });
      return sortedVersions[sortedVersions.length - 1];
    }
    return '0.0.0'; // Default if no versions found
  } catch {
    return '0.0.0'; // Default if package doesn't exist
  }
}

function updateSdkExportVersion(version: string): void {
  const indexPath = join(projectRoot, 'index.ts');
  const current = readFileSync(indexPath, 'utf8');
  const versionCommentPattern = /@version\s+\d+\.\d+\.\d+(?:-[\w.-]+)?/;
  const versionExportPattern = /export const VERSION = ['"]\d+\.\d+\.\d+(?:-[\w.-]+)?['"] as const;/;

  if (!versionCommentPattern.test(current) || !versionExportPattern.test(current)) {
    throw new Error('Could not find SDK version markers in index.ts');
  }

  const next = current
    .replace(versionCommentPattern, `@version ${version}`)
    .replace(versionExportPattern, `export const VERSION = '${version}' as const;`);

  writeFileSync(indexPath, next);
  logSuccess(`SDK export version updated: ${version}`);
}

function updatePackageLockVersion(version: string): void {
  const lockPath = join(projectRoot, 'package-lock.json');
  if (!existsSync(lockPath)) {
    return;
  }

  const packageLock = JSON.parse(readFileSync(lockPath, 'utf8'));
  packageLock.version = version;
  if (packageLock.packages?.['']) {
    packageLock.packages[''].version = version;
  }

  writeFileSync(lockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
  logSuccess(`package-lock version updated: ${version}`);
}

async function updateVersion(versionType?: 'patch' | 'minor' | 'major') {
  const branch = execSync('git branch --show-current', { 
    cwd: projectRoot, 
    encoding: 'utf8' as const
  }).trim();
  const isPreRelease = branch !== 'main' && branch !== 'master';
  
  if (versionType) {
    logStep(1.5, `Updating version (${versionType})`);
  } else if (isPreRelease) {
    logStep(1.5, 'Adding pre-release suffix');
  } else {
    logStep(1.5, 'Using current version');
  }
  try {
    const currentPackageVersion = getCurrentVersion();
    const latestPublishedVersion = getLatestPublishedVersion();
    
    logInfo(`Current package.json version: ${currentPackageVersion}`);
    logInfo(`Latest published version: ${latestPublishedVersion}`);
    logInfo(`Current branch: ${branch}`);
    
    // Use the current package.json version as the base
    const baseVersion = currentPackageVersion;
    
    // Parse version components (handle pre-release versions)
    const cleanVersion = baseVersion.includes('-') ? baseVersion.split('-')[0] : baseVersion;
    const [major, minor, patch] = cleanVersion.split('.').map(Number);
    let newVersion: string;
    
    // Determine if this is a pre-release branch
    const isPreRelease = branch !== 'main' && branch !== 'master';
    
    // Find the highest pre-release number for this branch and base version
    let highestPreReleaseNumber = 0;
    
    try {
      const packageName = getPackageName();
      const result = execSync(`npm view ${packageName} versions --json`, {
        cwd: projectRoot,
        encoding: 'utf8' as const
      });
      const versions = JSON.parse(result);
      
      if (Array.isArray(versions)) {
        // Find all pre-release versions for this branch with the same base version
        const branchVersions = versions.filter((v: string) => 
          v.startsWith(`${cleanVersion}-${branch}.`)
        );
        
        // Extract the highest pre-release number
        branchVersions.forEach((v: string) => {
          const preReleasePart = v.split(`-${branch}.`)[1];
          if (preReleasePart) {
            const num = parseInt(preReleasePart);
            if (!isNaN(num) && num > highestPreReleaseNumber) {
              highestPreReleaseNumber = num;
            }
          }
        });
      }
    } catch {
      // If we can't get versions, start at 0
      highestPreReleaseNumber = 0;
    }
    
    const nextPreReleaseNumber = highestPreReleaseNumber + 1;
    
    if (isPreRelease) {
      // For non-main branches, always add pre-release suffix
      if (versionType) {
        // If version type specified, increment the base version first and start new pre-release sequence
        let incrementedVersion: string;
        switch (versionType) {
        case 'patch':
          incrementedVersion = `${major}.${minor}.${patch + 1}`;
          break;
        case 'minor':
          incrementedVersion = `${major}.${minor + 1}.0`;
          break;
        case 'major':
          incrementedVersion = `${major + 1}.0.0`;
          break;
        }
        // Start new pre-release sequence at .1 for the new version
        newVersion = `${incrementedVersion}-${branch}.1`;
        logInfo(`New version with pre-release: ${branch} (starting new sequence at .1)`);
      } else {
        // No version type specified, use current version + pre-release suffix
        // Continue existing pre-release sequence
        newVersion = `${cleanVersion}-${branch}.${nextPreReleaseNumber}`;
        logInfo(`Continuing pre-release sequence: ${branch} (pre-release #${nextPreReleaseNumber})`);
      }
    } else {
      // For main branch, use clean versions (increment based on version type)
      if (versionType) {
        switch (versionType) {
        case 'patch':
          newVersion = `${major}.${minor}.${patch + 1}`;
          break;
        case 'minor':
          newVersion = `${major}.${minor + 1}.0`;
          break;
        case 'major':
          newVersion = `${major + 1}.0.0`;
          break;
        }
        logInfo(`Clean version for main branch: ${newVersion}`);
      } else {
        // No version type specified, use current version as-is (but clean it)
        newVersion = cleanVersion;
        logInfo(`Using clean version as-is: ${newVersion}`);
      }
    }
    
    updateSdkExportVersion(newVersion);

    // Update package.json directly
    const packageJsonPath = join(projectRoot, 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    packageJson.version = newVersion;
    
    // Write back to package.json
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
    updatePackageLockVersion(newVersion);
    
    logSuccess(`Version updated: ${currentPackageVersion} → ${newVersion}`);
    return newVersion;
  } catch {
    logError('Version update failed');
    logInfo('The version will remain unchanged and deployment will continue');
    return getCurrentVersion();
  }
}

function runTests() {
  logStep(2, 'Running tests');
  // Run tests with less verbose output - let errors bubble up
  exec('npm test', { stdio: 'pipe' });
  logSuccess('All tests passed');
}

function buildPackage() {
  logStep(3, 'Building package');
  // Run build with less verbose output - let errors bubble up
  exec('npm run build', { stdio: 'pipe' });
  logSuccess('Package build completed');
}

function validateBundles() {
  logStep(3.5, 'Validating CJS/ESM bundles');
  exec('npm run build:validate-bundles');
  logSuccess('Bundle validation passed');
}

async function publishPackage() {
  logStep(4, 'Publishing to npm registry');
  try {
    // Get current branch for tagging
    const branch = execSync('git branch --show-current', { 
      cwd: projectRoot, 
      encoding: 'utf8' as const
    }).trim();
    
    // Determine tag based on branch
    let publishTag = 'latest';
    if (branch === 'proto') {
      publishTag = 'proto';
    } else if (branch === 'dev' || branch === 'development') {
      publishTag = 'dev';
    } else if (branch === 'beta') {
      publishTag = 'beta';
    } else if (branch === 'alpha') {
      publishTag = 'alpha';
    } else if (branch !== 'main' && branch !== 'master') {
      publishTag = branch; // Use branch name as tag
    }
    
    logInfo(`Publishing with tag: ${publishTag} (branch: ${branch})`);
    
    // Try to publish with interactive stdio to support all 2FA methods (OTP, Security Keys, etc.)
    // We don't need a nested try-catch here just for re-throwing, the outer one will catch it.
    execSync(`npm publish --tag ${publishTag}`, { 
      cwd: projectRoot,
      stdio: 'inherit'
    });
    logSuccess(`Package published successfully to npm registry with tag: ${publishTag}`);
    
  } catch (error: unknown) {
    const err = error as { status?: number; stderr?: Buffer; stdout?: Buffer };
    
    // Show only the actual error, filter out notices
    if (err.stderr) {
      const stderr = err.stderr.toString();
      const errorLines = stderr.split('\n').filter(line => 
        line.startsWith('npm error') || 
        line.includes('403') || 
        line.includes('401') || 
        line.includes('404') || 
        line.includes('409') ||
        line.includes('Permission') ||
        line.includes('Forbidden') ||
        line.includes('Unauthorized')
      );
      
      if (errorLines.length > 0) {
        logError('npm publish error:');
        errorLines.forEach(line => console.log(line));
      }
    }
    
    // Provide specific error guidance
    if (err.status === 401) {
      logError('Authentication failed (401)');
      logInfo('Run: npm login');
    } else if (err.status === 403) {
      logError('Permission denied (403)');
      logInfo(`Check if you have permission to publish ${getPackageName()}`);
    } else if (err.status === 404) {
      logError('Package not found (404)');
      logInfo('Check your package name and registry configuration');
    } else if (err.status === 409) {
      logError('Version already exists (409)');
      logInfo('Try bumping the version or use --force if needed');
    }
    
    throw error;
  }
}

function verifyPublication() {
  logStep(5, 'Verifying publication');
  try {
    const version = getCurrentVersion();
    const packageName = getPackageName();
    const branch = execSync('git branch --show-current', { 
      cwd: projectRoot, 
      encoding: 'utf8' as const
    }).trim();
    
    // Determine tag based on branch (same logic as publish)
    let publishTag = 'latest';
    if (branch === 'proto') {
      publishTag = 'proto';
    } else if (branch === 'dev' || branch === 'development') {
      publishTag = 'dev';
    } else if (branch === 'beta') {
      publishTag = 'beta';
    } else if (branch === 'alpha') {
      publishTag = 'alpha';
    } else if (branch !== 'main' && branch !== 'master') {
      publishTag = branch;
    }
    
    // Try to verify the specific version
    try {
      const result = execSync(`npm view ${packageName}@${version} version`, { 
        encoding: 'utf8' as const,
        cwd: projectRoot,
        stdio: 'pipe' as const
      }).trim();
      
      if (result === version) {
        logSuccess(`Package ${version} is available on npm registry`);
      } else {
        logWarning(`Expected version ${version}, but found ${result}`);
      }
    } catch {
      // If specific version check fails, try checking the tag
      try {
        const tagResult = execSync(`npm view ${packageName}@${publishTag} version`, { 
          encoding: 'utf8' as const,
          cwd: projectRoot,
          stdio: 'pipe' as const
        }).trim();
        
        if (tagResult === version) {
          logSuccess(`Package ${version} is available on npm registry with tag: ${publishTag}`);
        } else {
          logInfo(`Tag ${publishTag} points to ${tagResult}, but we published ${version}`);
        }
      } catch {
        // If both checks fail, it might be a new package or tag
        logInfo(`Package ${version} published successfully (verification skipped for new package/tag)`);
      }
    }
  } catch {
    logInfo('Publication verification skipped (this is normal for new packages or tags)');
  }
}


async function deploy(versionType?: 'patch' | 'minor' | 'major') {
  const startTime = Date.now();
  
  log('🚀 Starting npm registry deployment...', colors.bright);
  log('', colors.reset);
  
  const initialVersion = getCurrentVersion();
  const initialIndexContent = readFileSync(join(projectRoot, 'index.ts'), 'utf8');
  const packageLockPath = join(projectRoot, 'package-lock.json');
  const initialPackageLockContent = existsSync(packageLockPath) ? readFileSync(packageLockPath, 'utf8') : null;
  logInfo(`Current version: ${initialVersion}`);
  
  // Update version if specified or if on non-main branch (to add pre-release suffix)
  const branch = execSync('git branch --show-current', { 
    cwd: projectRoot, 
    encoding: 'utf8' as const
  }).trim();
  const isPreRelease = branch !== 'main' && branch !== 'master';
  
  const _finalVersion = (versionType || isPreRelease) ? await updateVersion(versionType) : initialVersion;
  log('', colors.reset);
  
  try {
    checkPrerequisites();
    runTests();
    buildPackage();
    validateBundles();
    await publishPackage();
    verifyPublication();
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    log('', colors.reset);
    logSuccess('Deployment completed successfully!');
    logInfo(`Total time: ${duration}s`);
    log('', colors.reset);
    logInfo('Package is now available at:');
    const packageName = getPackageName();
    log(`   https://www.npmjs.com/package/${packageName}`, colors.reset);
    log('', colors.reset);
    
    // Show installation command with correct tag
    const branch = execSync('git branch --show-current', { 
      cwd: projectRoot, 
      encoding: 'utf8' as const
    }).trim();
    
    let publishTag = 'latest';
    if (branch === 'proto') {
      publishTag = 'proto';
    } else if (branch === 'dev' || branch === 'development') {
      publishTag = 'dev';
    } else if (branch === 'beta') {
      publishTag = 'beta';
    } else if (branch === 'alpha') {
      publishTag = 'alpha';
    } else if (branch !== 'main' && branch !== 'master') {
      publishTag = branch;
    }
    
    logInfo('Installation command:');
    if (publishTag === 'latest') {
      log(`   npm install ${packageName}`, colors.reset);
    } else {
      log(`   npm install ${packageName}@${publishTag}`, colors.reset);
    }
    
  } catch (error: unknown) {
    log('', colors.reset);
    logError('Deployment failed!');
    
    // Revert version if it was changed
    if (versionType) {
      log('📋 REVERT: Reverting version to original', colors.cyan);
      try {
        const packageJsonPath = join(projectRoot, 'package.json');
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        packageJson.version = initialVersion;
        
        writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
        writeFileSync(join(projectRoot, 'index.ts'), initialIndexContent);
        if (initialPackageLockContent !== null) {
          writeFileSync(packageLockPath, initialPackageLockContent);
        }
        logSuccess(`Version reverted to: ${initialVersion}`);
      } catch {
        logError('Failed to revert version - manual intervention required');
        logInfo(`Original version was: ${initialVersion}`);
      }
    }
    
    const err = error as { message?: string; status?: number; code?: string };
    
    // Filter out npm notices from the main error message
    let errorMessage = err.message || 'Unknown error';
    if (errorMessage.includes('npm notice')) {
      const lines = errorMessage.split('\n');
      const errorLines = lines.filter(line => 
        !line.startsWith('npm notice') && 
        line.trim() !== ''
      );
      errorMessage = errorLines.join('\n');
    }
    
    logError(`Error: ${errorMessage}`);
    
    // Show additional error details if available
    if (err.status) {
      logError(`Exit code: ${err.status}`);
    }
    if (err.code) {
      logError(`Error code: ${err.code}`);
    }
    
    process.exit(1);
  }
}

// Handle command line arguments
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
  case 'help':
  case '--help':
  case '-h':
    log('NPM Registry Deployment Script', colors.bright);
    log('', colors.reset);
    log('Usage: npx tsx publishing/deploy.ts [version-type]', colors.reset);
    log('', colors.reset);
    log('Version Types:', colors.reset);
    log('  (no argument)  - Deploy current version without changing it', colors.reset);
    log('  patch          - Deploy with patch version bump (1.0.0 → 1.0.1)', colors.reset);
    log('  minor          - Deploy with minor version bump (1.0.1 → 1.1.0)', colors.reset);
    log('  major          - Deploy with major version bump (1.1.0 → 2.0.0)', colors.reset);
    log('  help           - Show this help message', colors.reset);
    log('', colors.reset);
    log('Prerequisites:', colors.reset);
    log('  - npm login (run: npm login)', colors.reset);
    log(`  - Permission to publish ${getPackageName()}`, colors.reset);
    log('  - Clean git working directory', colors.reset);
    break;
  case 'patch':
  case 'minor':
  case 'major':
    await deploy(command);
    break;
  default:
    if (command) {
      logError(`Unknown command: ${command}`);
      logInfo('Run "npx tsx publishing/deploy.ts help" for available commands');
      process.exit(1);
    } else {
      await deploy();
    }
    break;
  }
}

main().catch(error => {
  logError('Unexpected error occurred');
  logError(error.message);
  process.exit(1);
});
