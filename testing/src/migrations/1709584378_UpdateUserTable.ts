import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateUserTable1709584378 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            "ALTER TABLE user MODIFY COLUMN email VARCHAR(512)"
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            "ALTER TABLE user MODIFY COLUMN email VARCHAR(255)"
        );
    }
}