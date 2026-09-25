# Publishing to NPM

This folder contains documentation for publishing the Kalvora JS SDK to the npm registry.

## Quick Start

### Deployment Commands

```bash
# Deploy with version bump
npm run deploy:patch  # 1.0.0 → 1.0.1
npm run deploy:minor  # 1.0.1 → 1.1.0
npm run deploy:major  # 1.1.0 → 2.0.0

# Deploy current version (no bump)
npm run deploy

# Get help
npm run deploy:help
```

### Maintenance Commands

```bash
# Unpublish current version
npm run unpublish

# Unpublish specific version
npx tsx publishing/unpublish.ts

# Deprecate a version with message
npm run deprecate

# Undeprecate a version (remove deprecation)
npm run deprecate

# DELETE ENTIRE PACKAGE (DESTRUCTIVE!)
npm run delete-package        # 120-second countdown
npm run delete-package:fast   # 10-second countdown
```

## Branch-Based Tagging

The deployment script automatically tags packages based on your current git branch:

| Branch              | Tag           | Usage               |
| ------------------- | ------------- | ------------------- | ------------------------------------------ |
| `main`/`master`     | `latest`      | Stable releases     | `npm install kalvora.js`             |
| `proto`             | `proto`       | Development/testing | `npm install kalvora.js@proto`       |
| `dev`/`development` | `dev`         | Development         | `npm install kalvora.js@dev`         |
| `beta`              | `beta`        | Beta testing        | `npm install kalvora.js@beta`        |
| `alpha`             | `alpha`       | Alpha testing       | `npm install kalvora.js@alpha`       |
| Custom branches     | `branch-name` | Feature branches    | `npm install kalvora.js@branch-name` |

## Prerequisites

1. **npm account** with permission to publish the unscoped `kalvora.js` package
2. **npm login** - Run `npm login` to authenticate
3. **2FA enabled** - Your account must have 2FA enabled for publishing
4. **Publishing permissions** - Access to publish `kalvora.js`

## Deployment Process

The deployment script (`deploy.ts`) handles:

1. **Prerequisites Check** - Validates npm login and permissions
2. **Version Management** - Automatically bumps version (if specified)
3. **Testing** - Runs all tests before publishing
4. **Building** - Compiles TypeScript and generates distribution files
5. **Publishing** - Uploads to npm registry with branch-based tag
6. **Verification** - Confirms successful publication

## Usage Examples

### Deployment

```bash
# Login to npm (first time)
npm login

# Deploy patch version
npm run deploy:patch  # Deploy patch version

# Check published versions
npm view kalvora.js dist-tags
```

### Maintenance

```bash
# Unpublish a problematic version
npm run unpublish  # Interactive unpublish tool

# Deprecate old versions
npm run deprecate  # Interactive deprecate tool
# Then enter version and message, or "undeprecate" to remove deprecation

# Examples of what you can do:
# - Deprecate: Enter version "1.0.0" and message "Use version 1.1.0 instead"
# - Undeprecate: Enter version "1.0.0" and message "undeprecate"
# - Batch operations: Enter "all" for version to affect all versions
```

## Installation Commands

```bash
# Install latest stable version
npm install kalvora.js

# Install development version
npm install kalvora.js@proto

# Install specific development branch
npm install kalvora.js@dev
```

## Features

- **✅ Standard npm Workflow** - No custom registry setup
- **🔍 Better Discoverability** - Available on npmjs.com
- **🏷️ Branch-Based Tagging** - Automatic tag assignment
- **🔐 2FA Support** - Interactive OTP prompting
- **📦 Version Management** - Automatic version bumping
- **🧪 Pre-Publish Testing** - Ensures quality before release
- **🚀 Simple Import** - `import { ... } from 'kalvora.js'`

## Troubleshooting

### 2FA Authentication

If you get an OTP error, the script will automatically prompt you for your 6-digit code from your authenticator app.

### Version Already Exists

If you get a 403 error about existing versions, use a version bump command:

```bash
npm run deploy:patch  # Instead of npm run deploy
```

### Permission Denied

Ensure you have publishing permissions for the `kalvora.js` package on npm.

### Unpublish Restrictions

- **24-hour rule**: You can only unpublish versions published within the last 24 hours
- **Dependencies**: You cannot unpublish versions that other packages depend on
- **Confirmation required**: The script will ask for confirmation before unpublishing

### Deprecation Best Practices

- **Clear messages**: Provide specific reasons for deprecation
- **Migration path**: Always suggest an alternative version
- **Timeline**: Give users time to migrate before removing deprecated versions
- **Undeprecation**: Use "undeprecate" message to remove deprecation warnings

### Package Deletion (DESTRUCTIVE!)

- **⚠️ PERMANENT**: Package deletion cannot be undone
- **⚠️ BREAKS APPS**: All applications using the package will fail
- **⚠️ 24-HOUR RULE**: Must be within 24 hours of last publish
- **⚠️ DEPENDENCIES**: Cannot delete if other packages depend on it
- **⚠️ DOUBLE CONFIRMATION**: Script requires two separate confirmations
- **⚠️ 120-SECOND COUNTDOWN**: Final warning before deletion (use --fast for 10 seconds)
