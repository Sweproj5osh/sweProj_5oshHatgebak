import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { migrate } from '../adapters/postgres/migrate';
import { readPostgresUrl } from '../adapters/postgres/postgres-url';
import { TEST_APPLICATION_PASSWORD, TEST_APPLICATION_ROLE, testRunPrefix, urlFor } from './postgres-test-names';

/**
 * Test-only, run once per `vitest run` (ADR-21): the tests run only against a real PostgreSQL named by POSTGRES_URL
 * (a role that may create databases). One template database gets every migration; each test application then gets its
 * own database cloned from it. The run's databases are dropped at the end; no row of audit_log is ever updated or
 * deleted. The application connects as a login role that holds exactly the grants of `sayes_application`.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const adminUrl = readPostgresUrl(process.env);
  const run = `${process.pid}_${Date.now().toString(36)}`;
  const template = `${testRunPrefix(run)}template`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${template}"`);
    await migrate(urlFor(adminUrl, template));
    await admin.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TEST_APPLICATION_ROLE}') THEN
          CREATE ROLE ${TEST_APPLICATION_ROLE} LOGIN PASSWORD '${TEST_APPLICATION_PASSWORD}' IN ROLE sayes_application;
        END IF;
      END $$`);
  } finally {
    await admin.end();
  }
  project.provide('sayesTestRun', run);
  return () => dropTheRunsDatabases(adminUrl, run);
}

async function dropTheRunsDatabases(adminUrl: string, run: string): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const databases = await admin.query<{ datname: string }>('SELECT datname FROM pg_database WHERE datname LIKE $1', [`${testRunPrefix(run)}%`]);
    for (const { datname } of databases.rows) {
      await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
}
