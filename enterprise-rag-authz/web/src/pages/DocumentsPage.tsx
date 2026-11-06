import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent, type FormEvent } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ApiError,
  deleteDocument,
  listDocuments,
  uploadDocument,
  type DocumentRecord,
  type DocumentStatus,
} from '@/lib/api';
import { defaultTitle, MAX_UPLOAD_BYTES, uploadType } from '@/lib/files';

// Mirrors the API's list. The API is what rejects anything else.
const GROUPS = ['all-staff', 'engineering', 'hr', 'finance', 'legal'];
const IN_FLIGHT: DocumentStatus[] = ['PENDING', 'PROCESSING', 'DELETING'];

function message(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return "This document is still processing. Try again when it's finished.";
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function StatusBadge({ document }: { document: DocumentRecord }) {
  const variant =
    document.status === 'FAILED'
      ? 'destructive'
      : document.status === 'INDEXED'
        ? 'secondary'
        : 'outline';
  return <Badge variant={variant}>{document.status.toLowerCase()}</Badge>;
}

export function DocumentsPage({ token, tenant }: { token: string; tenant: string }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [groups, setGroups] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DocumentRecord | null>(null);

  const documents = useQuery({
    queryKey: ['documents'],
    queryFn: () => listDocuments(token),
    // Polls only while something is moving through the pipeline.
    refetchInterval: (query) =>
      query.state.data?.some((document) => IN_FLIGHT.includes(document.status)) ? 3000 : false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['documents'] });

  const upload = useMutation({
    mutationFn: (input: { file: File; contentType: NonNullable<ReturnType<typeof uploadType>> }) =>
      uploadDocument(token, input.file, title.trim(), input.contentType, groups),
    onSuccess: () => {
      setFile(null);
      setTitle('');
      setGroups([]);
      setProblem(null);
    },
    onError: (error) => setProblem(message(error)),
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: (docId: string) => deleteDocument(token, docId),
    onError: (error) => setProblem(message(error)),
    onSettled: refresh,
  });

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setProblem(null);
    if (chosen && !title) setTitle(defaultTitle(chosen.name));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    const contentType = uploadType(file.name);
    if (!contentType) return setProblem('Choose a PDF or Markdown file.');
    if (file.size > MAX_UPLOAD_BYTES) return setProblem('The file is over the 10 MB limit.');
    if (groups.length === 0) return setProblem('Choose at least one group that may read it.');
    upload.mutate({ file, contentType });
  }

  function toggleGroup(group: string, checked: boolean) {
    setGroups((current) =>
      checked ? [...current, group] : current.filter((name) => name !== group),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload a document</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex max-w-xl flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="file">PDF or Markdown, up to 10 MB</Label>
              <Input
                id="file"
                type="file"
                accept=".pdf,.md,.markdown"
                key={file ? 'chosen' : 'empty'}
                onChange={onFile}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Who may read it</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {GROUPS.map((group) => (
                  <Label key={group} className="font-normal">
                    <Checkbox
                      checked={groups.includes(group)}
                      onCheckedChange={(checked) => toggleGroup(group, checked)}
                    />
                    {group}
                  </Label>
                ))}
              </div>
              <p className="text-muted-foreground text-sm">
                Access is fixed at upload. To change it, delete the document and upload it again.
              </p>
            </fieldset>
            <div>
              <Button type="submit" disabled={!file || !title.trim() || upload.isPending}>
                {upload.isPending ? 'Uploading…' : 'Upload'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {problem && (
        <Alert variant="destructive">
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Documents at {tenant}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {documents.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : documents.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{message(documents.error)}</AlertDescription>
            </Alert>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Readers</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Chunks</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.data.map((document) => (
                  <TableRow key={document.doc_id}>
                    <TableCell className="font-medium whitespace-normal">
                      {document.title}
                      {document.error && (
                        <div className="text-destructive text-sm font-normal">{document.error}</div>
                      )}
                    </TableCell>
                    <TableCell>{document.allowed_groups.join(', ')}</TableCell>
                    <TableCell>
                      <StatusBadge document={document} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {document.chunk_count}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={document.status === 'PROCESSING'}
                        onClick={() => setPendingDelete(document)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this document?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.title} will stop appearing in answers. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) remove.mutate(pendingDelete.doc_id);
                setPendingDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
