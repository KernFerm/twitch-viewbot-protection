# Security Policy

## Supported Versions

Use this section to tell people about which versions of your project are
currently being supported with security updates.

| Version | Supported   |
| ------- | ----------- |
| 1.0.0   | ✅ Supported |

## Reporting a Vulnerability

Please include:

1. A clear description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if available)

## Security Response Process

1. **Acknowledgment**: We aim to acknowledge all valid reports within 48 hours.
2. **Assessment**: We will evaluate the severity and risk and assign a priority.
3. **Resolution**: A patch or mitigation will be developed and tested.
4. **Release**: We will publish a security release note and update the affected versions.
5. **Disclosure**: Following responsible disclosure, we will credit the reporter.

## Supported Platforms

This project is supported on Node.js 16 and above. We test release builds
on macOS, Linux, and Windows.

## Security Best Practices

* Keep your `.env` file out of source control.
* Rotate your Twitch credentials regularly.
* Run `npm audit` as part of your CI pipeline to catch new vulnerabilities.

## Acknowledgements

Thanks to everyone who has reported issues and helped make this project more secure.
