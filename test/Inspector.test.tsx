import { render, screen, fireEvent } from '@testing-library/react';
import { Inspector } from '../src/webview/src/Inspector';

describe('Inspector Component', () => {
  const mockOnChange = jest.fn();
  const mockOnDelete = jest.fn();
  
  const defaultProps = {
    state: { project: { targets: [] }, readinessChecklist: [], efficiencyScore: 100 },
    node: { id: '1', type: 'testType', label: 'Test Node', config: {}, inferred: null },
    target: 'all',
    findings: [],
    onChange: mockOnChange,
    onDelete: mockOnDelete,
  };

  test('renders NodeInspector when node is provided', () => {
    render(<Inspector {...defaultProps} />);
    expect(screen.getByText('Test Node')).toBeInTheDocument();
  });

  test('renders ProjectPanel when no node is provided', () => {
    render(<Inspector {...{ ...defaultProps, node: undefined }} />);
    expect(screen.getByText('No SkillCraft project in this folder yet.')).toBeInTheDocument();
  });

  test('calls onChange when input value changes', () => {
    render(<Inspector {...defaultProps} />);
    const input = screen.getByLabelText('Name');
    fireEvent.change(input, { target: { value: 'New Name' } });
    expect(mockOnChange).toHaveBeenCalledWith('1', { label: 'New Name' });
  });

  test('calls onDelete when delete button is clicked', () => {
    render(<Inspector {...defaultProps} />);
    const deleteButton = screen.getByRole('button', { name: /Remove from workflow/i });
    fireEvent.click(deleteButton);
    expect(mockOnDelete).toHaveBeenCalledWith('1');
  });
});
