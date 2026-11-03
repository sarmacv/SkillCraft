import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Checks } from '../webview/src/Checks';

describe('Checks Component', () => {
  const mockOnSelectNode = jest.fn();
  const mockState = {
    findings: [
      { area: 'structure', severity: 'error', message: 'Error message', nodeId: 'node1', file: 'file1.ts' },
      { area: 'integrity', severity: 'warning', message: 'Warning message', nodeId: 'node2', file: 'file2.ts' },
    ],
  };

  test('renders all clear message when no findings', () => {
    render(<Checks state={{ findings: [] }} onSelectNode={mockOnSelectNode} />);
    expect(screen.getByText(/All checks pass/i)).toBeInTheDocument();
  });

  test('renders findings correctly', () => {
    render(<Checks state={mockState} onSelectNode={mockOnSelectNode} />);
    expect(screen.getByText(/Structure/i)).toBeInTheDocument();
    expect(screen.getByText(/Integrity/i)).toBeInTheDocument();
    expect(screen.getByText(/Error message/i)).toBeInTheDocument();
    expect(screen.getByText(/Warning message/i)).toBeInTheDocument();
  });

  test('calls onSelectNode when Show on canvas button is clicked', () => {
    render(<Checks state={mockState} onSelectNode={mockOnSelectNode} />);
    fireEvent.click(screen.getByText(/Show on canvas/i));
    expect(mockOnSelectNode).toHaveBeenCalledWith('node1');
  });

  test('calls post function when Open button is clicked', () => {
    const postMock = jest.fn();
    jest.mock('./vscode', () => ({
      post: postMock,
    }));
    render(<Checks state={mockState} onSelectNode={mockOnSelectNode} />);
    fireEvent.click(screen.getByText(/Open file1.ts/i));
    expect(postMock).toHaveBeenCalledWith({ type: 'openFinding', finding: mockState.findings[0] });
  });

  test('calls post function when Review fix button is clicked', () => {
    const postMock = jest.fn();
    jest.mock('./vscode', () => ({
      post: postMock,
    }));
    render(<Checks state={mockState} onSelectNode={mockOnSelectNode} />);
    fireEvent.click(screen.getByText(/Review fix/i));
    expect(postMock).toHaveBeenCalledWith({ type: 'proposal', key: undefined, action: 'preview' });
  });
});
