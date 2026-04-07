import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { Label } from './label.entity';

@Entity()
export class EmailLabel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  labelId: string;

  @Column()
  folder: string;

  @Column()
  uid: number;

  @Column()
  userId: string;

  @ManyToOne(() => Label, (label) => label.emailLabels, { onDelete: 'CASCADE' })
  label: Label;
}
