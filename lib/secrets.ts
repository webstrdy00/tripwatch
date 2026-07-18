const SECRET_KEY_PATTERN = /(secret|token|password|passwd|pwd|api[_-]?key|credential|auth|session|cookie)/i;
const MIN_SECRET_LENGTH = 4;

type MaskSecretsOptions = {
  extraSecrets?: readonly string[];
  env?: NodeJS.ProcessEnv;
};

function collectSecretValues(options: MaskSecretsOptions): string[] {
  const env = options.env ?? process.env;
  const values = new Set<string>();

  for (const [key, value] of Object.entries(env)) {
    if (!value || value.length < MIN_SECRET_LENGTH) {
      continue;
    }

    if (SECRET_KEY_PATTERN.test(key)) {
      values.add(value);
    }
  }

  for (const value of options.extraSecrets ?? []) {
    if (value.length >= MIN_SECRET_LENGTH) {
      values.add(value);
    }
  }

  return [...values].sort((a, b) => b.length - a.length);
}

export function maskSecrets(input: string, options: MaskSecretsOptions = {}): string {
  let output = input;

  for (const value of collectSecretValues(options)) {
    output = output.split(value).join("[REDACTED]");
  }
  output = output.replace(
    /((?:proxy-)?authorization\s*[:=]\s*)(?:bearer|basic)\s+[^"'\s,;]+/gi,
    "$1[REDACTED]"
  );

  output = output.replace(
    /((?:secret|token|password|passwd|pwd|api[_-]?key|credential|auth|session|cookie)[\w.-]*\s*[:=]\s*)(["']?)[^"'\s]+(\2)/gi,
    "$1$2[REDACTED]$3"
  );

  return output;
}
