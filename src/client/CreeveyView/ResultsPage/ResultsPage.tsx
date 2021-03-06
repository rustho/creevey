import React, { useContext, useState } from 'react';
import { css } from '@emotion/core';
import { CreeveyContext } from '../../CreeveyContext';
import { ImagesView } from '../ImagesView';
import { PageHeader } from './PageHeader';
import { TestResult, ImagesViewMode } from '../../../types';
import { PageFooter } from './PageFooter';
import { getImageUrl } from '../../helpers';

interface TestResultsProps {
  id: string;
  path: string[];
  results?: TestResult[];
  approved?: Partial<{ [image: string]: number }>;
}

export function ResultsPage({ id, path, results = [], approved = {} }: TestResultsProps): JSX.Element {
  const { onImageApprove } = useContext(CreeveyContext);
  const [retry, setRetry] = useState(results.length);
  const result = results[retry - 1] ?? {};
  const [imageName, setImageName] = useState(Object.keys(result.images ?? {})[0] ?? '');
  const [viewMode, setViewMode] = useState<ImagesViewMode>('side-by-side');

  const url = getImageUrl(path, imageName);
  const image = result.images?.[imageName];
  const canApprove = Boolean(image && approved[imageName] != retry - 1 && result.status != 'success');
  const hasDiffAndExpect = canApprove && Boolean(image?.diff && image.expect);

  const handleApprove = (): void => onImageApprove(id, retry - 1, imageName);

  return (
    <div
      css={css`
        width: 100%;
        display: flex;
        flex-direction: column;
      `}
    >
      <PageHeader
        title={path}
        images={result.images}
        errorMessage={result.error}
        showViewModes={hasDiffAndExpect}
        onViewModeChange={setViewMode}
        onImageChange={setImageName}
      />
      <div
        css={css`
          background: #eee;
          height: 100%;
        `}
      >
        {image ? (
          <ImagesView url={url} image={image} canApprove={canApprove} mode={viewMode} />
        ) : (
          <div
            css={css`
              height: 100%;
              align-items: center;
              justify-content: center;
              display: flex;
            `}
          >{`Image ${imageName} not found`}</div>
        )}
      </div>
      <div
        css={css`
          position: sticky;
          bottom: 0;
          z-index: 1;
        `}
      >
        <PageFooter
          canApprove={canApprove}
          retriesCount={results.length}
          onRetryChange={setRetry}
          onApprove={handleApprove}
        />
      </div>
    </div>
  );
}
