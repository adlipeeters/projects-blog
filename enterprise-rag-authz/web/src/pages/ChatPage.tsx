import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, streamChat, type RetrievedDocument } from '@/lib/api';
import { plainExcerpt, splitAnswer } from '@/lib/citations';
import type { ServerEvent } from '@/lib/sse';

interface Answer {
  text: string;
  documents: RetrievedDocument[];
  dropped: number;
  citations: RetrievedDocument[];
  invalid: number[];
  answered: boolean;
  finished: boolean;
}

const EMPTY: Answer = {
  text: '',
  documents: [],
  dropped: 0,
  citations: [],
  invalid: [],
  answered: true,
  finished: false,
};

function applyEvent(answer: Answer, event: ServerEvent): Answer {
  switch (event.name) {
    case 'retrieval': {
      const data = event.data as { documents: RetrievedDocument[]; dropped: number };
      return { ...answer, documents: data.documents, dropped: data.dropped };
    }
    case 'token':
      return { ...answer, text: answer.text + (event.data as { text: string }).text };
    case 'citations': {
      const data = event.data as {
        citations: RetrievedDocument[];
        invalid: number[];
        answered: boolean;
      };
      return {
        ...answer,
        citations: data.citations,
        invalid: data.invalid,
        answered: data.answered,
      };
    }
    case 'done':
      return { ...answer, finished: true };
    case 'error':
      throw new Error((event.data as { message: string }).message);
    default:
      return answer;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return "You've reached your usage limit. Try again in a minute, or tomorrow for the daily limit.";
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function CitationButton(props: {
  number: number;
  title?: string;
  active: boolean;
  onClick: () => void;
}) {
  const label = props.title ? `Source ${props.number}: ${props.title}` : `Source ${props.number}`;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={props.onClick}
      className="mx-0.5 cursor-pointer align-text-top"
    >
      <Badge variant={props.active ? 'default' : 'secondary'}>{props.number}</Badge>
    </button>
  );
}

function location(document: RetrievedDocument): string {
  if (document.page) return `page ${document.page}`;
  return document.heading_path;
}

export function ChatPage({ token, onExpired }: { token: string; onExpired: () => void }) {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const sources = useRef(new Map<number, HTMLLIElement>());

  useEffect(() => () => controller.current?.abort(), []);

  const ask = useMutation({
    mutationFn: async (text: string) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      setAnswer(EMPTY);
      setSelected(null);
      await streamChat(
        token,
        text,
        (event) => setAnswer((state) => applyEvent(state ?? EMPTY, event)),
        current.signal,
      );
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) onExpired();
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  });

  function openSource(number: number) {
    setSelected(number);
    // On a phone the panel sits below the answer.
    sources.current.get(number)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = question.trim();
    if (text && !ask.isPending) ask.mutate(text);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <Textarea
            aria-label="Your question"
            placeholder="Ask about your company's documents"
            value={question}
            maxLength={2000}
            rows={3}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <div>
            <Button type="submit" disabled={ask.isPending || !question.trim()}>
              {ask.isPending ? 'Answering…' : 'Ask'}
            </Button>
          </div>
        </form>

        {ask.isError && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(ask.error)}</AlertDescription>
          </Alert>
        )}

        {answer && (answer.text || ask.isPending) && (
          <Card>
            <CardContent>
              <p className="leading-7 break-words whitespace-pre-wrap" aria-live="polite">
                {splitAnswer(answer.text, answer.invalid).map((part, index) =>
                  part.kind === 'text' ? (
                    <span key={index}>{part.text}</span>
                  ) : (
                    <CitationButton
                      key={index}
                      number={part.number}
                      title={answer.documents.find((d) => d.number === part.number)?.title}
                      active={selected === part.number}
                      onClick={() => openSource(part.number)}
                    />
                  ),
                )}
              </p>
              {answer.answered && answer.invalid.length > 0 && (
                <p className="text-muted-foreground mt-3 text-sm">
                  Removed a citation that didn't match any retrieved excerpt.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {answer && !ask.isError && (
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Retrieved for you</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {answer.documents.length === 0 ? (
              <p className="text-muted-foreground">No documents above the relevance threshold.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {answer.documents.map((document) => {
                  const open = selected === document.number;
                  return (
                    <li
                      key={document.number}
                      ref={(element) => {
                        if (element) sources.current.set(document.number, element);
                        else sources.current.delete(document.number);
                      }}
                    >
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setSelected(open ? null : document.number)}
                        className={`hover:bg-muted flex w-full cursor-pointer gap-2 rounded-md p-1.5 text-left ${open ? 'bg-muted' : ''}`}
                      >
                        <Badge variant={open ? 'default' : 'secondary'}>{document.number}</Badge>
                        <span className="min-w-0">
                          <span className="block font-medium break-words">{document.title}</span>
                          <span className="text-muted-foreground block break-words">
                            {location(document)}
                          </span>
                          <span className="text-muted-foreground block tabular-nums">
                            Relevance {document.score.toFixed(2)}
                          </span>
                        </span>
                      </button>
                      {open && (
                        <p className="text-muted-foreground mt-2 max-h-72 overflow-y-auto border-l-2 pl-3 break-words whitespace-pre-wrap">
                          {plainExcerpt(document.text)}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="text-muted-foreground border-t pt-3 tabular-nums">
              Chunks dropped by the recheck: {answer.dropped}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
