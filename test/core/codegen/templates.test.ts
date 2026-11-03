import { header, isManaged, python, EXT, RUNNER } from '../../src/core/codegen/templates';

describe('Templates', () => {
  describe('header', () => {
    it('should generate correct header for python', () => {
      const result = header('python', 'Test Purpose');
      expect(result).toContain('#!/usr/bin/env python3');
      expect(result).toContain('# skillcraft:managed — generated from workflow.json. Delete this line to take ownership of the file.');
      expect(result).toContain('# Test Purpose');
    });

    it('should generate correct header for node', () => {
      const result = header('node', 'Test Purpose');
      expect(result).toContain('#!/usr/bin/env node');
    });

    it('should generate correct header for bash', () => {
      const result = header('bash', 'Test Purpose');
      expect(result).toContain('# skillcraft:managed — generated from workflow.json. Delete this line to take ownership of the file.');
    });
  });

  describe('isManaged', () => {
    it('should return true for managed files', () => {
      const result = isManaged('# skillcraft:managed — generated from workflow.json. Delete this line to take ownership of the file.\n');
      expect(result).toBe(true);
    });

    it('should return false for non-managed files', () => {
      const result = isManaged('This is a test file.\n');
      expect(result).toBe(false);
    });
  });

  describe('python function', () => {
    it('should generate correct python code', () => {
      const result = python('Test Purpose', [], [], []);
      expect(result).toContain('def main()');
      expect(result).toContain('print(json.dumps(result, indent=2, default=str) if not isinstance(result, str) else result)');
    });
  });
});
