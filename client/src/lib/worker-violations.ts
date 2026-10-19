// Solo en builds de prueba: los e2e leen las violaciones de CSP del worker (self.__cspViolations).
declare global {
  var __cspViolations: Array<{ directive: string; blockedURI: string }> | undefined;
}

if (import.meta.env.PUBLIC_TEST_HOOKS === '1') {
  const violations: Array<{ directive: string; blockedURI: string }> = [];
  globalThis.__cspViolations = violations;
  globalThis.addEventListener('securitypolicyviolation', (event) => {
    const violation = event as SecurityPolicyViolationEvent;
    violations.push({ directive: violation.effectiveDirective || violation.violatedDirective, blockedURI: violation.blockedURI });
  });
}

export {};
