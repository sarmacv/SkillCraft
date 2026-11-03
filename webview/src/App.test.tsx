import React from 'react';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App Component', () => {
  test('renders loading state when state is undefined', () => {
    render(<App />);
    expect(screen.getByText(/Loading SkillCraft…/i)).toBeInTheDocument();
  });

  // Additional tests can be added here to cover more functionality
});
