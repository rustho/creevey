import React, { useContext } from 'react';
import Spinner from '@skbkontur/react-ui/Spinner';
import Button from '@skbkontur/react-ui/Button';
import Input from '@skbkontur/react-ui/Input';
import { css } from '@emotion/core';
import SearchIcon from '@skbkontur/react-icons/Search';
import { CreeveyContex } from 'src/client/CreeveyContext';

interface SideBarHeaderProps {
  onStart: () => void;
  onStop: () => void;
  onFilterChange: (rawFilter: string) => void;
}

export function SideBarHeader({ onStop, onStart, onFilterChange }: SideBarHeaderProps) {
  const { isRunning } = useContext(CreeveyContex);

  const handleFilterChange = (_: React.ChangeEvent, value: string) => onFilterChange(value);

  return (
    <div
      css={css`
        padding: 24px;
      `}
    >
      <div
        css={css`
          padding-right: 56px;
          display: flex;
          justify-content: space-between;
        `}
      >
        <div>
          <div
            css={css`
              font-family: Segoe UI;
              font-size: 24px;
            `}
          >
            colin.creavey
          </div>
          текстовочки
        </div>
        <div
          css={css`
            margin-top: 10px;
          `}
        >
          {isRunning ? (
            <Button use="primary" size="medium" width={100} onClick={onStop}>
              <Spinner type="mini" /> Running
            </Button>
          ) : (
            <Button use="primary" arrow size="medium" width={100} onClick={onStart}>
              Start
            </Button>
          )}
        </div>
      </div>
      <div
        css={css`
          margin-top: 24px;
        `}
      >
        <Input
          width="100%"
          placeholder="search by status or substring"
          size="medium"
          rightIcon={<SearchIcon />}
          onChange={handleFilterChange}
        />
      </div>
    </div>
  );
}